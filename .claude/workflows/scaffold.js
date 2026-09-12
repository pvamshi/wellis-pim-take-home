export const meta = {
  name: 'scaffold',
  description: 'Scaffold the Intake monorepo: NestJS backend, React + Mantine frontend, SQLite/TypeORM, Vitest',
  whenToUse: 'Once, at the start of the project, to turn the stack decisions in notes/rough-drafts.md into a running skeleton.',
  phases: [
    { title: 'Clarify', detail: 'is the work fully specified? gaps stop the unit' },
    { title: 'Implement', detail: 'build exactly what was clarified' },
    { title: 'Review', detail: 'independent check: does it run, does it match' },
    { title: 'Commit', detail: 'one commit per unit, pushed to origin' },
    { title: 'Report', detail: 'what exists, what is missing, what to run' },
  ],
}

const STACK = 'notes/tech-stack.md'
const OPEN = 'notes/unresolved-questions.md'
const DEFER = 'notes/deferred.md'
const NOTES = 'notes/rough-drafts.md'

const GROUND_RULES = `
Ground rules for every agent in this workflow:
- Read ${STACK} first. It is the source of truth for every technology decision.
  Do not substitute your own preferences for what it says. ${NOTES} section 5
  describes how this workflow itself is meant to run.
- Read ${OPEN}. Everything listed there is undecided. If your work depends on one
  of those answers, you have found a gap — you have not found permission to pick.
  The exception is a question marked deferred or not blocking: that one has been
  looked at and set aside on purpose. Build around it and leave it alone.
- Read ${DEFER}. Everything there was cut deliberately. Do not build it back.
- Never write to notes/final-requirements.md.
- Scaffold only. No product features. No import logic, no rules engine, no
  intake forms, no review console. Those are separate, later workflows.
- Do not invent requirements. If something is genuinely undecided, say so —
  do not guess a direction and build on it.
- Committing is a separate step run by a dedicated agent, one unit at a time, so
  that two agents never contend for the git index. Do not run git commit, git
  push, git rebase, git reset or git checkout yourself unless you ARE that agent.
  Reading git state (status, diff, log) is fine for anyone.
- Package manager is npm workspaces.
`

const CLARIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    clear: {
      type: 'boolean',
      description: 'true only if this unit can be built without guessing at any decision',
    },
    requirements: {
      type: 'array',
      items: { type: 'string' },
      description: 'The work restated as unambiguous, checkable statements',
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string' },
          blocks: { type: 'string', description: 'What cannot be built until this is answered' },
        },
        required: ['question', 'blocks'],
      },
      description: 'Only decisions that are genuinely not yours. Any entry here means clear=false.',
    },
    decided: {
      type: 'array',
      items: { type: 'string' },
      description: 'Choices you made because the notes were silent, each with one line on why',
    },
    summary: { type: 'string' },
  },
  required: ['clear', 'requirements', 'gaps', 'decided', 'summary'],
}

const IMPLEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    created: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths created' },
    commands: { type: 'array', items: { type: 'string' }, description: 'Commands to install, dev, build, test this unit' },
    todos: { type: 'array', items: { type: 'string' }, description: 'Deliberately unfinished, each naming what it waits on' },
    summary: { type: 'string' },
  },
  required: ['created', 'commands', 'todos', 'summary'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true only if it runs AND matches every clarified requirement' },
    ran: { type: 'array', items: { type: 'string' }, description: 'Commands actually executed' },
    failures: { type: 'array', items: { type: 'string' }, description: 'Command plus error, for anything that did not exit 0' },
    unmet: { type: 'array', items: { type: 'string' }, description: 'Clarified requirements the implementation does not satisfy' },
    overreach: { type: 'array', items: { type: 'string' }, description: 'Things built that nobody asked for' },
    summary: { type: 'string' },
  },
  required: ['ok', 'ran', 'failures', 'unmet', 'overreach', 'summary'],
}

const COMMIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    committed: { type: 'boolean' },
    sha: { type: 'string', description: 'Short sha, or empty if nothing was committed' },
    message: { type: 'string', description: 'The commit subject line used' },
    pushed: { type: 'boolean' },
    problem: { type: 'string', description: 'Why it did not commit or push, empty otherwise' },
  },
  required: ['committed', 'sha', 'message', 'pushed', 'problem'],
}

const ROOT = {
  key: 'root',
  dir: '.',
  brief: `Set up the repository root.

It currently holds ASSIGNMENT.md, README.md, notes/ and legacy_export/ — leave
all of those alone.

- npm workspaces covering apps/*. Create the apps/ directory.
- TypeScript base config that the two apps extend.
- Shared lint and format config.
- .gitignore covering node_modules, build output, .env files, and local SQLite
  database files. legacy_export/ and notes/ must stay tracked.
- .env.example documenting every environment variable the stack needs, with the
  database ones shown in both shapes: a local file path, and a Turso URL plus
  auth token.
- A justfile with the top-level commands: install, dev (both apps), build, test.
- Do NOT overwrite README.md.`,
}

const APPS = [
  {
    key: 'backend',
    dir: 'apps/api',
    brief: `Scaffold the backend at apps/api.

- NestJS + TypeScript.
- TypeORM, with SQLite. No Prisma. No migration tooling — entities plus schema
  sync is enough; we ship one final schema state, not a chain of migrations.
- One \`DATABASE_URL\` whose scheme selects the driver: \`file:\` locally,
  \`libsql://\` when deployed, with \`TURSO_AUTH_TOKEN\` set only in the second case.
  Nothing else decides — not NODE_ENV, not a mode flag. See tech-stack §4.6.1.
  TypeORM ships no libSQL driver, so wire the better-sqlite3 driver and hand it
  the \`libsql\` npm package as the driver module — \`libsql\` exposes a
  better-sqlite3-compatible API. Put this behind one config module so the rest of
  the app never knows which it is talking to.
- Vitest, not Jest. Remove the Jest wiring the Nest CLI generates.
- Tests run against a real temporary SQLite database file, not mocks. Provide the
  helper that creates and tears one down per suite, and one passing smoke test
  that proves it works.
- A health endpoint reporting whether the database is reachable.
- No domain entities beyond what the smoke test needs.`,
  },
  {
    key: 'frontend',
    dir: 'apps/web',
    brief: `Scaffold the frontend at apps/web.

- React + TypeScript, built with Vite.
- Mantine as the component library, core packages only. Do NOT add
  mantine-datatable or any other data grid — the tables we need are simple, and
  we will revisit if that changes.
- No test setup at all. Frontend testing is a deliberate scope cut — do not add
  Vitest, Testing Library, Playwright, or any test script here.
- A typed API client pointed at the backend through one env var for the base URL,
  and a single page that calls the backend health endpoint and renders the
  result. That is the whole UI for now — it exists to prove the two halves talk.
- \`react-router-dom\`, with a minimal route tree — one route for the health page.
  Plain nested routes, no data loaders, no framework mode. See tech-stack §4.1.`,
  },
]

// Every unit of work goes through the same three agents: one checks the
// requirements are unambiguous, one implements exactly that, one reviews.
// A unit that is not clear is not built — its gaps go back to the human.
async function build(unit) {
  const clarified = await agent(
    `${GROUND_RULES}

You are the CLARIFY agent for the "${unit.key}" unit. You do not write any code.
Your job is to turn the brief into unambiguous, checkable requirements.

Read ${STACK}, ${OPEN}, ${DEFER} and the repository as it stands.

You are expected to DECIDE, not to ask. This is scaffolding: almost every choice
here is reversible in minutes, and a human has already been asked the questions
worth asking. Where the notes are silent, pick the conventional answer for this
stack, write it into the requirements explicitly so the implementer cannot
diverge, and list it in \`decided\` with one line on why. Strictness is not the
goal — an unambiguous brief is.

Set clear=false ONLY when the decision is genuinely not yours: product behaviour,
what the data means, anything a user sees and depends on, or anything expensive
to undo once built. A missing lint rule, a config flag, a file name, a folder
layout, a default port — decide it and move on.

If you find yourself with more than two gaps, you are being too strict. Re-read
them and decide the ones that are merely unstated conventions.

Brief:
${unit.brief}

Return the structured result.`,
    { label: `clarify:${unit.key}`, phase: 'Clarify', schema: CLARIFY_SCHEMA },
  )

  if (!clarified || !clarified.clear) {
    const gaps = clarified ? clarified.gaps.length : 0
    log(`${unit.key}: NOT CLEAR (${gaps} gap${gaps === 1 ? '' : 's'}) — not building it`)
    return { unit: unit.key, dir: unit.dir, clarified, implemented: null, review: null, built: false }
  }

  const implemented = await agent(
    `${GROUND_RULES}

You are the IMPLEMENT agent for the "${unit.key}" unit, at ${unit.dir}.

Build exactly the requirements below — all of them, and nothing beyond them.
They have already been checked for ambiguity, so do not reinterpret them. If you
hit something they genuinely do not cover, leave a TODO naming the decision
rather than inventing an answer.

Requirements:
${clarified.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Original brief, for context only — the requirements above win where they differ:
${unit.brief}

Return the structured result.`,
    { label: `implement:${unit.key}`, phase: 'Implement', schema: IMPLEMENT_SCHEMA },
  )

  const review = await agent(
    `${GROUND_RULES}

You are the REVIEW agent for the "${unit.key}" unit, at ${unit.dir}. You did not
build this. Judge what is actually on disk, not what the implementer claims.

Two questions, both of which must pass:

1. Does it run? From the repository root: npm install, then build ${unit.dir}.
   For the backend also run the Vitest suite and boot the app long enough to hit
   the health endpoint against a local SQLite file. For the frontend run the
   production build only — there are no tests here by design, do not add any.
   Fix what is broken, but only enough to make it run. Do not redesign.

2. Does it match? Check each requirement below against the code. Report any that
   are unmet. Also report overreach — anything built that nobody asked for.

ok is false if anything still fails after your fixes, or if anything is unmet.

Requirements it was built against:
${clarified.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

What the implementer says it did:
${implemented ? JSON.stringify(implemented, null, 2) : '(the implementer returned nothing — find out what is actually on disk)'}

Return the structured result.`,
    { label: `review:${unit.key}`, phase: 'Review', schema: REVIEW_SCHEMA },
  )

  return { unit: unit.key, dir: unit.dir, clarified, implemented, review, built: true }
}

// Commits are deliberately serial. Two agents running `git add` in the same
// repository at the same time fight over index.lock.
async function commitStep(label, description) {
  return agent(
    `You are the COMMIT agent. Commit the work described below and push it.

${description}

- Run \`git status\` first. If nothing is staged or unstaged, commit nothing and
  report committed=false with problem="nothing to commit". That is a normal
  outcome, not a failure.
- Stage only what belongs to this step. Never \`git add -A\` blindly — check what
  is there first, and never commit .env files, local SQLite database files, or
  node_modules. If .gitignore does not already cover those, say so in problem.
- Write a real commit message: a subject line naming what changed, and a body
  saying why. This repository's history is read by reviewers, so no
  "wip" or "updates".
- End the commit message with this trailer, on its own line:
  Claude-Session: https://claude.ai/code/session_01JfKEerG6aNmgBAP4AqVS7e
- Then push to origin on the current branch. If the push is rejected or there is
  no upstream, do NOT force, rebase, reset or checkout anything — report
  pushed=false with the exact error in problem and stop.

Return the structured result.`,
    { label: `commit:${label}`, phase: 'Commit', schema: COMMIT_SCHEMA },
  )
}

// Root first — the apps are workspaces inside it.
const root = await build(ROOT)
const commits = []
if (root.built && root.review && root.review.ok) {
  commits.push(await commitStep('root', 'The repository root scaffold: npm workspaces, shared TypeScript and lint config, .gitignore, .env.example, justfile.'))
}

let apps = []
if (root.built && root.review && root.review.ok) {
  apps = (await pipeline(APPS, (app) => build(app))).filter(Boolean)
  // Serial on purpose — see commitStep.
  for (const app of apps) {
    if (app.built && app.review && app.review.ok) {
      commits.push(await commitStep(app.unit, `The ${app.unit} scaffold at ${app.dir}. ${app.implemented ? app.implemented.summary : ''}`))
    } else {
      log(`${app.unit}: not committing — it did not pass review`)
    }
  }
} else {
  log('Root unit did not pass — skipping the apps rather than building on a broken base')
}

const units = [root, ...apps]
const unclear = units.filter((u) => !u.built)
const failing = units.filter((u) => u.built && (!u.review || !u.review.ok))
log(`${units.length} units: ${unclear.length} blocked on gaps, ${failing.length} failing review`)

phase('Report')
const report = await agent(
  `Write the scaffold report for this project.

Read the repository as it now stands. Do not trust the summaries below over what
is actually on disk — if they disagree, say so, and believe the disk.

${JSON.stringify(units, null, 2)}

Write notes/scaffold-report.md covering:
- What now exists, unit by unit, and the commands to run each.
- Every unit that was NOT built because its requirements were unclear, and the
  exact gaps that blocked it.
- Every TODO left behind and the decision it waits on.
- Anything unmet, overreaching, or still failing, with the actual error.

Then append to notes/unresolved-questions.md: every gap from the clarify agents
and every decision the implementers had to make alone, phrased as open questions.
Do not touch any other section of that file. Do not write to
notes/final-requirements.md at all.

Commits already made, for context:
${JSON.stringify(commits, null, 2)}

Do not run any git command yourself — a separate agent commits this.

Return a one-paragraph plain-text summary of what you wrote.`,
  { label: 'report' },
)

commits.push(await commitStep('notes', 'The scaffold report and the open questions it raised, under notes/.'))

return {
  units,
  blocked: unclear.map((u) => u.unit),
  failing: failing.map((u) => u.unit),
  commits,
  report,
}
