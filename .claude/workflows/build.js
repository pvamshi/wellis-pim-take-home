export const meta = {
  name: 'build',
  description: 'Build the legacy-migration infrastructure task by task: plan, develop, review, commit',
  whenToUse: 'To work through notes/tasks.md. Pass args to limit which phases run, e.g. args: [1,2].',
  phases: [
    { title: 'Plan', detail: 'read the requirements, decide the approach, write no code' },
    { title: 'Develop', detail: 'build exactly the plan' },
    { title: 'Review', detail: 'independent check against the requirement addresses' },
    { title: 'Commit', detail: 'one commit per task, pushed, only once it passes' },
  ],
}

const TASKS = 'notes/tasks.md'
const REQS = 'notes/final-requirements.md'
const STACK = 'notes/tech-stack.md'
const DEFER = 'notes/deferred.md'
const OPEN = 'notes/unresolved-questions.md'

const GROUND_RULES = `
Ground rules for every agent in this workflow:

- ${REQS} is the contract. A task names the requirement addresses it satisfies;
  those addresses, and only those, are what "correct" means for it. Read them.
- ${TASKS} holds the task itself — what it is, what its tests must prove.
- ${STACK} is the source of truth for every technology decision. Do not
  substitute your own preferences.
- ${DEFER} is what was cut on purpose. Never build it back.
- ${OPEN} is what is still undecided. Do not decide any of it. If your task
  depends on one of those answers, say so and stop.
- Never write to ${REQS}. Never write to ${OPEN}.

- Build ONLY the task you were given. Not the next one, not a helper the next one
  will want, not a refactor you noticed. Scope creep here is expensive because
  another agent is about to build that thing properly.
- We are building the infrastructure rules run on, NOT the rules. Tests use fake
  rules. Do not write real rules against the legacy data.
- Committing is a separate agent's job. Do not run git commit, git push, git
  rebase, git reset or git checkout. Reading git state is fine.
- Node 22, npm workspaces. The commands are 'just build', 'just test'.
`

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    approach: { type: 'string', description: 'How this gets built, in a few sentences' },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'Repo-relative paths this task will create or change, and nothing beyond them',
    },
    steps: { type: 'array', items: { type: 'string' }, description: 'Ordered steps for the developer' },
    tests: {
      type: 'array',
      items: { type: 'string' },
      description: 'Each test to write, stated as what it proves — traceable to a requirement',
    },
    decided: {
      type: 'array',
      items: { type: 'string' },
      description: 'Choices made where the requirements were silent, each with one line on why',
    },
    blocked: { type: 'boolean', description: 'true only if this cannot be built without deciding something undecided' },
    blockedOn: { type: 'string', description: 'What is undecided, empty if not blocked' },
  },
  required: ['approach', 'files', 'steps', 'tests', 'decided', 'blocked', 'blockedOn'],
}

const DEV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    changed: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths created or modified' },
    tests: { type: 'array', items: { type: 'string' }, description: 'Tests written, by name' },
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    departures: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anywhere you departed from the plan, and why',
    },
    summary: { type: 'string' },
  },
  required: ['changed', 'tests', 'buildPassed', 'testsPassed', 'departures', 'summary'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true only if it builds, tests pass, and every named requirement is met' },
    ran: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' }, description: 'Command plus error for anything not exiting 0' },
    unmet: {
      type: 'array',
      items: { type: 'string' },
      description: 'Requirement addresses the code does not satisfy, each with what is wrong',
    },
    overreach: { type: 'array', items: { type: 'string' }, description: 'Anything built that the task did not ask for' },
    weakTests: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tests that pass without proving what they claim',
    },
    summary: { type: 'string' },
  },
  required: ['ok', 'ran', 'failures', 'unmet', 'overreach', 'weakTests', 'summary'],
}

const COMMIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    committed: { type: 'boolean' },
    sha: { type: 'string' },
    message: { type: 'string' },
    pushed: { type: 'boolean' },
    problem: { type: 'string' },
  },
  required: ['committed', 'sha', 'message', 'pushed', 'problem'],
}

const PHASES = [
  { n: 1, title: 'Legacy data in the database', tasks: ['T1.1', 'T1.2'] },
  { n: 2, title: 'Rules storage', tasks: ['T2.1', 'T2.2', 'T2.3'] },
  { n: 3, title: 'Rule execution', tasks: ['T3.1', 'T3.2', 'T3.3', 'T3.4'] },
  { n: 4, title: 'Decisions', tasks: ['T4.1', 'T4.2', 'T4.3', 'T4.4'] },
  { n: 5, title: 'Read endpoints for the screen', tasks: ['T5.1', 'T5.2'] },
  { n: 6, title: 'Review console', tasks: ['T6.1', 'T6.2', 'T6.3', 'T6.4'] },
  { n: 7, title: 'Revision', tasks: ['T7.1'] },
]

// Each task is its own plan / develop / review / commit chain, with a fresh agent
// at every step. Nothing carries over but the structured result, so no agent
// inherits another's context.
async function runTask(id) {
  const planned = await agent(
    `${GROUND_RULES}

You are the PLANNING agent for task ${id}. You write no code.

Find ${id} in ${TASKS}. Read every requirement address it names in ${REQS} —
the Gherkin scenarios there are what the tests have to demonstrate. Read the
repository as it stands, including what earlier tasks already built, so you plan
against what is actually there rather than what you assume.

Produce the plan: the approach, the exact files to touch, ordered steps, and each
test stated as what it proves.

Where the requirements are silent on something small and reversible, decide it
and record it in \`decided\`. Set blocked=true only if the task genuinely cannot
be built without settling something listed in ${OPEN} — that is not yours to
settle.

Return the structured result.`,
    { label: `plan:${id}`, phase: 'Plan', schema: PLAN_SCHEMA },
  )

  if (!planned || planned.blocked) {
    log(`${id}: BLOCKED — ${planned ? planned.blockedOn : 'planning agent returned nothing'}`)
    return { id, planned, dev: null, review: null, attempts: 0, passed: false }
  }

  let dev = null
  let review = null
  let attempts = 0

  // Two attempts. The second one gets the reviewer's findings and nothing else
  // changes, so a genuine misunderstanding surfaces rather than being papered over.
  while (attempts < 2) {
    attempts += 1
    const retry =
      attempts === 1
        ? ''
        : `
This is attempt ${attempts}. A previous developer built this and it failed review.
Fix exactly what the reviewer found and nothing else.

Unmet requirements: ${JSON.stringify(review.unmet, null, 2)}
Failures: ${JSON.stringify(review.failures, null, 2)}
Weak tests: ${JSON.stringify(review.weakTests, null, 2)}
Overreach to remove: ${JSON.stringify(review.overreach, null, 2)}
`

    dev = await agent(
      `${GROUND_RULES}

You are the DEVELOPMENT agent for task ${id}. Build it.

The plan below has already been checked against the requirements. Follow it. If
you must depart from it, do so and say why in \`departures\` — do not silently
reinterpret it.

Plan:
${JSON.stringify(planned, null, 2)}
${retry}
Write the tests the plan names. A test has to fail if the behaviour is wrong —
asserting that a function was called is not a test of what it does.

Run 'just build' and 'just test' before you finish, and report honestly:
buildPassed and testsPassed must be false if they are.

Return the structured result.`,
      { label: `dev:${id}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Develop', schema: DEV_SCHEMA },
    )

    review = await agent(
      `${GROUND_RULES}

You are the REVIEW agent for task ${id}. You did not build this. Judge what is on
disk, not what the developer claims.

Three questions, all of which must pass.

1. Does it run? Run 'just build' and 'just test' from the repository root. Fix
   nothing — report what fails.

2. Does it satisfy its requirements? Find ${id} in ${TASKS}, read every
   requirement address it names in ${REQS}, and check each one against the code.
   The Gherkin scenarios are the specification. List anything unmet, naming the
   address.

3. Are the tests real? A test that passes whether or not the behaviour is correct
   is worse than no test. List those in weakTests.

Also list overreach: anything built that ${id} did not ask for, including
groundwork for a later task.

ok is false if anything fails, is unmet, or is a weak test.

What the developer says it did:
${JSON.stringify(dev, null, 2)}

Return the structured result.`,
      { label: `review:${id}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Review', schema: REVIEW_SCHEMA },
    )

    if (review && review.ok) break
    log(`${id}: attempt ${attempts} failed review${attempts < 2 ? ', retrying' : ''}`)
  }

  const passed = Boolean(review && review.ok)
  return { id, planned, dev, review, attempts, passed }
}

// Serial on purpose. Two agents running `git add` in one repository fight over
// index.lock, and tasks inside a phase touch the same module wiring.
async function commitTask(result) {
  return agent(
    `You are the COMMIT agent. Commit task ${result.id} and push it.

${result.dev ? result.dev.summary : ''}

- Run \`git status\` first. If there is nothing to commit, report committed=false
  with problem="nothing to commit". That is a normal outcome, not a failure.
- Stage only what belongs to this task. Never \`git add -A\` blindly. Never commit
  .env files, local SQLite database files, or node_modules.
- Write a real commit message: a subject line naming what changed, and a body
  saying why. Reviewers read this history, so no "wip" and no bare task ids.
- End the message with this trailer on its own line:
  Claude-Session: https://claude.ai/code/session_01JfKEerG6aNmgBAP4AqVS7e
- Push to origin on the current branch. If the push is rejected, do NOT force,
  rebase, reset or checkout — report pushed=false with the exact error and stop.

Return the structured result.`,
    { label: `commit:${result.id}`, phase: 'Commit', schema: COMMIT_SCHEMA },
  )
}

const only = Array.isArray(args) && args.length ? args.map(Number) : null
const selected = only ? PHASES.filter((p) => only.includes(p.n)) : PHASES

const done = []
const commits = []
let halted = null

for (const p of selected) {
  log(`Phase ${p.n} — ${p.title} (${p.tasks.length} task${p.tasks.length === 1 ? '' : 's'})`)

  for (const id of p.tasks) {
    const result = await runTask(id)
    done.push(result)

    if (!result.passed) {
      halted = `${id} did not pass review after ${result.attempts} attempt(s)`
      log(`HALT: ${halted}. Everything after it depends on it, so nothing further runs.`)
      break
    }

    commits.push(await commitTask(result))
  }

  if (halted) break
}

return {
  tasks: done.map((t) => ({
    id: t.id,
    passed: t.passed,
    attempts: t.attempts,
    blockedOn: t.planned && t.planned.blocked ? t.planned.blockedOn : '',
    decided: t.planned ? t.planned.decided : [],
    unmet: t.review ? t.review.unmet : [],
    overreach: t.review ? t.review.overreach : [],
  })),
  commits,
  halted,
}
