export const meta = {
  name: 'revise',
  description: 'Revise every rule version the user sent back, one new version at a time',
  whenToUse:
    'Run manually when rule versions carry needsReview — the queue Decline and the ticked cross fill. Pass rule ids as args to revise only those, e.g. args: ["R7"].',
  phases: [
    { title: 'Queue', detail: 'read every version waiting to be revised' },
    { title: 'Revise', detail: 'write the next version, register it, apply the revision' },
    { title: 'Review', detail: 'independent check that the revision landed and nothing else moved' },
    { title: 'Commit', detail: 'one commit per revision, pushed, only once it passes' },
    { title: 'Effects', detail: 'what the revised rules would do to the data, through the rule-effects workflow' },
  ],
}

const REQS = 'notes/final-requirements.md'
const STACK = 'notes/tech-stack.md'
const DEFER = 'notes/deferred.md'
const OPEN = 'notes/unresolved-questions.md'
const CATALOGUE = 'apps/api/src/rules/rule-catalogue.ts'
const CONTRACT = 'apps/api/src/rules/rule-contract.ts'

const GROUND_RULES = `
Ground rules for every agent in this workflow:

- ${REQS} is the contract. This workflow is 1.5.1 and 1.5.2: feedback is what
  drives revision, and a revision may split into two rules. Read them.
- ${STACK} is the source of truth for every technology decision. Do not
  substitute your own preferences.
- ${DEFER} is what was cut on purpose. Never build it back.
- ${OPEN} is what is still undecided. Do not decide any of it.
- Never write to ${REQS}. Never write to ${OPEN}.

What a rule is, before you write one (${CONTRACT} is the type):

- A rule never writes (1.1.2). It is handed reads and nothing else.
- A rule is ONE function, called ONCE, returning everything it found in one
  response (1.1.14) — not one call per row.
- A finding is always field-shaped: table, legacyId, column, prev, next (1.1.7).
  An ambiguous rule returns ambiguity true and a null next on every update
  (1.1.12).
- One rule, one fix (1.1.4). If the feedback describes two problems, that is a
  narrowed version plus a second rule (1.5.2), never one rule doing both.
- Entries already in ${CATALOGUE} are appended to, never edited and never
  removed: rule rows already written point at those keys by version, and the
  modification log reads them (1.1.1, 1.1.8, 1.3).

- Never approve or decline anything. Those are the human's presses, and this
  workflow exists because they were already made.
- Node 22, npm workspaces. The commands are 'just build' and 'just test'.
`

const QUEUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entries: {
      type: 'array',
      description: 'The queue exactly as the command printed it, entry for entry',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ruleId: { type: 'string' },
          version: { type: 'number', description: 'The declined version, the one being revised' },
          reason: { type: 'string', description: 'Empty string when the decline carried no reason' },
          ruleName: { type: 'string' },
          description: { type: 'string' },
          ambiguous: { type: 'boolean' },
          nextVersion: { type: 'number', description: 'The number the new version must take' },
        },
        required: ['ruleId', 'version', 'reason', 'ruleName', 'description', 'ambiguous', 'nextVersion'],
      },
    },
    problem: { type: 'string', description: 'Command plus error if it did not run; empty otherwise' },
  },
  required: ['entries', 'problem'],
}

const REVISE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    applied: { type: 'boolean', description: 'true only if the revision command exited 0' },
    ruleId: { type: 'string' },
    reviewedVersion: { type: 'number' },
    newVersion: { type: 'number', description: '0 if this revision wrote no new version' },
    newVersionActivated: { type: 'boolean' },
    newRuleId: { type: 'string', description: 'Empty if no rule was created alongside' },
    newRuleActivated: { type: 'boolean' },
    changed: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths written' },
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    rationale: { type: 'string', description: 'What the feedback said, and what the new code does about it' },
    problem: { type: 'string', description: 'What went wrong, empty if nothing did' },
  },
  required: [
    'applied',
    'ruleId',
    'reviewedVersion',
    'newVersion',
    'newVersionActivated',
    'newRuleId',
    'newRuleActivated',
    'changed',
    'buildPassed',
    'testsPassed',
    'rationale',
    'problem',
  ],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true only if every check below passed' },
    ran: { type: 'array', items: { type: 'string' }, description: 'Commands run, with their exit status' },
    problems: {
      type: 'array',
      items: { type: 'string' },
      description: 'Everything wrong, each naming what was checked and what was found',
    },
    summary: { type: 'string' },
  },
  required: ['ok', 'ran', 'problems', 'summary'],
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

// The queue entry as an agent reads it, so three prompts describe it one way.
function describe(entry) {
  return `Rule ${entry.ruleId}, version ${entry.version} — "${entry.ruleName}"
Description: ${entry.description}
Ambiguous: ${entry.ambiguous}
Why it was declined: ${entry.reason || '(no reason was given)'}
The new version must be numbered ${entry.nextVersion}.`
}

// The revision itself: write the code, register the key, prove it runs, apply it.
// One queued version per agent, so no agent holds two rules' feedback at once.
function revisePrompt(entry, attempt, review) {
  const retry =
    attempt === 1
      ? ''
      : `
This is attempt ${attempt}. A previous agent revised this and it failed review.
Fix exactly what the reviewer found and nothing else.

Problems: ${JSON.stringify(review ? review.problems : [], null, 2)}
`

  return `${GROUND_RULES}

You are the REVISE agent. One queued rule version, and nothing else.

${describe(entry)}
${retry}
Read before you write: the rule's row and its versions in the database through
'just revise queue', the code its current version runs in ${CATALOGUE}, and the
rule contract in ${CONTRACT}.

Decide which of the three shapes 1.5.2 allows this feedback calls for:

1. a new version of this rule, replacing what it did;
2. a narrowed new version of this rule AND a new rule alongside it for the case
   it was missing — one rule, one fix (1.1.4);
3. a new rule that takes over while this rule stays parked, with its new version
   written but not activated.

Then:

- Write the new rule function. Registering it is an appended entry in
  ${CATALOGUE} under (ruleId, version) — version ${entry.nextVersion} for this
  rule, version 1 for a rule created alongside. Never edit or remove an existing
  entry.
- Run 'just build' and 'just test'. Both must pass before you apply anything: an
  active version whose code does not compile aborts the next run (1.1.14).
- Write the revision as JSON to a temporary file OUTSIDE this repository, then
  apply it with 'just revise apply <path to that file>'. The file is
  { ruleId, version, newVersion?: { version, activate? }, newRule?: { ruleId,
  ruleName, description, ambiguous, activate? } }. 'version' is the version you
  were handed, ${entry.version} — the one being reviewed. 'activate' defaults to
  true; pass false only for shape 3, where this rule stays parked.
- The command writes the rows and clears needsReview. Do not write to the
  database any other way, and never by hand.

Report what you did, including the rationale a reviewer needs to judge it.

Return the structured result.`
}

// A second agent, given the same feedback and none of the first one's reasoning.
function reviewPrompt(entry, built) {
  return `${GROUND_RULES}

You are the REVIEW agent. You did not write this. Judge what is on disk and in
the database, not what the revise agent claims.

${describe(entry)}

Check every one of these, and report each that fails:

1. 'just build' and 'just test' pass from the repository root. Fix nothing.
2. The new version's key is in ${CATALOGUE} and has a function behind it.
3. The reviewed version's code and its catalogue entry are UNCHANGED. Prove it
   with 'git diff' — an edited old entry rewrites history that rule rows already
   point at (1.1.1, 1.3).
4. 'just revise queue' no longer lists rule ${entry.ruleId} version
   ${entry.version}.
5. That rule now has exactly one active version, and it is the new one — unless
   the revision deliberately parked it, in which case say so and check the rule
   created alongside is the one that is active.
6. The new code is a rule: one function, called once, writing nothing, returning
   field-shaped findings (1.1.2, 1.1.7, 1.1.14) — and it answers the feedback
   above rather than something adjacent to it.

What the revise agent says it did:
${JSON.stringify(built, null, 2)}

Return the structured result.`
}

// Serial, and a fresh agent: every revision appends to the one catalogue file
// and commits, so two of these at once would fight over both, and over
// index.lock. No session trailer in the message either — a future run happens in
// another session, and this session's URL baked in here would be a false one.
function commitPrompt(entry, built) {
  return `You are the COMMIT agent. Commit this revision and push it.

${describe(entry)}

${built.rationale}

- Run \`git status\` first. If there is nothing to commit, report committed=false
  with problem="nothing to commit". That is a normal outcome, not a failure.
- Stage only the rule code and ${CATALOGUE}. Never \`git add -A\` blindly. Never
  commit .env files, local SQLite database files, or node_modules — the revision
  itself is rows in a database, not a file.
- Write a real commit message: a subject line naming the rule and its new
  version, and a body saying which feedback drove it and what the new code does
  differently. Reviewers read this history.
- Push to origin on the current branch. If the push is rejected, do NOT force,
  rebase, reset or checkout — report pushed=false with the exact error and stop.

Return the structured result.`
}

phase('Queue')

const read = await agent(
  `${GROUND_RULES}

You are the QUEUE agent. You write nothing, to no file and to no database.

Run 'just revise queue' from the repository root. It prints a JSON array of
every rule version carrying needsReview — the queue 1.5.1 describes, filled by
Decline on a rule (1.2.6) and by the ticked cross on a row (1.2.8).

Return the entries exactly as printed, one for one, with no rule left out and
nothing invented. A reason the command printed as null is an empty string here.
An empty array is a normal outcome: report it as no entries, not as a problem.
If the command itself fails, return no entries and put the command and its error
in problem.

Return the structured result.`,
  { label: 'queue', phase: 'Queue', schema: QUEUE_SCHEMA },
)

const queued = read ? read.entries : []

if (read && read.problem) {
  log(`queue: ${read.problem}`)
}

// args names rule ids to revise. Anything not named is skipped, and skipping is
// logged: a silently shortened queue reads as an empty one.
const wanted = Array.isArray(args) && args.length ? args.map(String) : null
const entries = wanted ? queued.filter((entry) => wanted.includes(entry.ruleId)) : queued

if (wanted) {
  log(`args names ${wanted.join(', ')}: ${queued.length - entries.length} of ${queued.length} queued version(s) skipped`)
}

const revised = []
const failed = []
const commits = []

if (!entries.length) {
  log('Nothing is queued for revision. That is what an empty review queue looks like, not a failure.')
} else {
  log(`${entries.length} version(s) queued for revision`)
}

// One at a time, deliberately. Every revision appends to the same catalogue file
// and commits, and revisions are independent of one another — so a failure is
// recorded and the queue carries on, rather than halting what is left.
for (const entry of entries) {
  const id = `${entry.ruleId}@${entry.version}`
  let built = null
  let review = null
  let attempts = 0

  while (attempts < 2) {
    attempts += 1

    phase('Revise')
    built = await agent(revisePrompt(entry, attempts, review), {
      label: `revise:${id}${attempts > 1 ? `#${attempts}` : ''}`,
      phase: 'Revise',
      schema: REVISE_SCHEMA,
    })

    phase('Review')
    review = await agent(reviewPrompt(entry, built), {
      label: `review:${id}${attempts > 1 ? `#${attempts}` : ''}`,
      phase: 'Review',
      schema: REVIEW_SCHEMA,
    })

    if (review && review.ok) break
    log(`${id}: attempt ${attempts} failed review${attempts < 2 ? ', retrying' : ''}`)
  }

  if (review && review.ok && built) {
    revised.push({ id, built, review })
    phase('Commit')
    commits.push(
      await agent(commitPrompt(entry, built), {
        label: `commit:${id}`,
        phase: 'Commit',
        schema: COMMIT_SCHEMA,
      }),
    )
  } else {
    failed.push({ id, problems: review ? review.problems : ['the review agent returned nothing'] })
    log(`${id}: not revised after ${attempts} attempt(s). It stays in the queue; continuing with the rest.`)
  }
}

// A revised rule is seen before anyone presses Apply rules (1.5.3). By now the
// revisions are committed and active, so what is left to know is what they
// would do to the data — for a rule created alongside a revision too.
const changedRules = [
  ...new Set(revised.flatMap((entry) => [entry.built.ruleId, entry.built.newRuleId].filter(Boolean))),
]
let effects = null

if (changedRules.length) {
  phase('Effects')

  try {
    effects = await workflow('rule-effects', changedRules)
  } catch (error) {
    log(`effects: the rule-effects workflow did not run (${error.message}). Run it by hand with args ${JSON.stringify(changedRules)}.`)
  }
}

return {
  queued: entries.length,
  revised: revised.map((entry) => ({
    id: entry.id,
    newVersion: entry.built.newVersion,
    newRuleId: entry.built.newRuleId,
    rationale: entry.built.rationale,
  })),
  failed,
  commits,
  effects,
}
