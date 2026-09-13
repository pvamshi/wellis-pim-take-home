export const meta = {
  name: 'rules',
  description: 'Implement the rule catalogue one rule at a time: develop, review, commit, sync',
  whenToUse: 'To work through notes/rule-catalogue.md. Pass rule ids to do only those, e.g. args: ["P03","P10"].',
  phases: [
    { title: 'Develop', detail: 'write the rule, register it, test it' },
    { title: 'Review', detail: 'independent check against the catalogue entry' },
    { title: 'Land', detail: 'sync the database, then commit and push' },
  ],
}

const CATALOGUE = 'notes/rule-catalogue.md'
const REQS = 'notes/final-requirements.md'
const OPEN = 'notes/unresolved-questions.md'
const DEFER = 'notes/deferred.md'

const GROUND_RULES = `
Ground rules for every agent in this workflow:

- ${CATALOGUE} holds the rule: its id, the column it is on, what it catches,
  what it proposes, and whether it is ambiguous. That entry is the contract.
- ${REQS} is what a rule must obey. The ones that bind every rule:
  1.1.4 atomic — one rule, one fix.
  1.1.5 same column — a rule changes the column it tested, never another.
  1.1.7 field-shaped — a finding is (table, row, column, prev, next).
  1.1.12 ambiguity is rule-wide — one flag for the whole response.
  1.1.14 called once — read whole tables, return every change in one batch.
  1.1.2 writes nothing — the context has no save, insert, update or delete.
- ${DEFER} is what was cut on purpose. Never build it back.
- ${OPEN} is undecided. Do not decide any of it.
- Never write to ${REQS} or ${OPEN}.

How a rule is added:
- One file per rule under apps/api/src/rules/catalogue/, named for the rule id.
- It exports a CatalogueRule: ruleId, version 1, ruleName, description,
  ambiguous, and run.
- It is appended to ruleCatalogue in apps/api/src/rules/rule-catalogue.ts.
  Entries are appended, never reordered and never removed.
- 'description' is what a human reads in the console. For an ambiguous rule it
  is the whole explanation, since there is no proposed value to show — write it
  as a sentence about this row's problem, not as a note to a developer.

Tests:
- One spec per rule, against a temporary database with fixture rows.
- It must prove the rule catches what the catalogue says it catches, leaves
  everything else alone, and returns the right ambiguity flag.
- A rule that proposes a value is tested on the value it proposes, not only on
  whether it fired.

- Do not run git commit, git push, git rebase, git reset or git checkout. A
  separate agent commits. Reading git state is fine.
- Do not touch any rule but the one you were given.
`

const DEV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    changed: { type: 'array', items: { type: 'string' } },
    ruleName: { type: 'string' },
    description: { type: 'string' },
    ambiguous: { type: 'boolean' },
    tests: { type: 'array', items: { type: 'string' }, description: 'Tests written, each as what it proves' },
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    decided: {
      type: 'array',
      items: { type: 'string' },
      description: 'Choices made where the catalogue entry was silent, each with one line on why',
    },
    summary: { type: 'string' },
  },
  required: ['changed', 'ruleName', 'description', 'ambiguous', 'tests', 'buildPassed', 'testsPassed', 'decided', 'summary'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: {
      type: 'boolean',
      description:
        'true if it builds, tests pass, the rule matches its catalogue entry, and it obeys 1.1.4, 1.1.5, 1.1.7, 1.1.12, 1.1.14 and 1.1.2',
    },
    ran: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
    unmet: {
      type: 'array',
      items: { type: 'string' },
      description: 'Where the rule departs from its catalogue entry or breaks a named requirement',
    },
    weakTests: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' }, description: 'Anything a human should look at. Never fatal.' },
    summary: { type: 'string' },
  },
  required: ['ok', 'ran', 'failures', 'unmet', 'weakTests', 'notes', 'summary'],
}

const LAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    synced: { type: 'boolean', description: 'true if just rules-sync added the rule and its version' },
    syncReport: { type: 'string' },
    committed: { type: 'boolean' },
    sha: { type: 'string' },
    pushed: { type: 'boolean' },
    problem: { type: 'string' },
  },
  required: ['synced', 'syncReport', 'committed', 'sha', 'pushed', 'problem'],
}

// Every rule in the catalogue, in the order it appears there. Not a priority
// order — the catalogue says so itself.
const RULES = [
  ...Array.from({ length: 65 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 38 }, (_, i) => `I${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 13 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 6 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`),
]

async function buildRule(id) {
  let dev = null
  let review = null
  let attempts = 0

  while (attempts < 2) {
    attempts += 1
    // `review` is null when the review agent died rather than returned a
    // verdict — a session limit, an API error. Retry against what it said only
    // when it said anything.
    const retry =
      attempts === 1
        ? ''
        : review
          ? `
This is attempt ${attempts}. A previous developer built this and it failed review.
Fix exactly what the reviewer found and nothing else.

Unmet: ${JSON.stringify(review.unmet, null, 2)}
Failures: ${JSON.stringify(review.failures, null, 2)}
Weak tests: ${JSON.stringify(review.weakTests, null, 2)}
`
          : `
This is attempt ${attempts}. A previous developer built this and the reviewer
died before returning a verdict, so nothing is known about what is wrong. Check
what is already on disk for this rule, finish or correct it, and make sure
'just build' and 'just test' pass.
`

    dev = await agent(
      `${GROUND_RULES}

You are the DEVELOPMENT agent for rule ${id}. Write it.

Find ${id} in ${CATALOGUE}. Build exactly that rule — the column it names, the
problem it names, the fix it names, and its ambiguity marking. Nothing wider.

Read an existing rule under apps/api/src/rules/catalogue/ first if any exist, and
follow it. If none exist you are setting the pattern, so keep it plain.
${retry}
Run 'just build' and 'just test'. Report honestly — buildPassed and testsPassed
must be false if they are.

Return the structured result.`,
      { label: `dev:${id}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Develop', schema: DEV_SCHEMA },
    )

    review = await agent(
      `${GROUND_RULES}

You are the REVIEW agent for rule ${id}. You did not write it. Judge what is on
disk, not what the developer claims.

1. Run 'just build' and 'just test'. Fix nothing — report what fails.
2. Compare the rule to its entry in ${CATALOGUE}. Does it catch what the entry
   says, and propose what the entry says? Does its ambiguity flag match?
3. Check the binding requirements: is it atomic (1.1.4), does it change only the
   column it tested (1.1.5), is the finding field-shaped (1.1.7), is ambiguity
   rule-wide (1.1.12), is it called once and answering in batch (1.1.14), and
   does it write nothing (1.1.2)?
4. Are the tests real? A test that passes whether or not the rule works is worse
   than no test. Check it asserts the proposed value, not just that it fired.

ok is false only for a failing build or test, a departure from the catalogue
entry, a broken requirement, or a weak test. Anything else goes in notes.

What the developer says it did:
${JSON.stringify(dev, null, 2)}

Return the structured result.`,
      { label: `review:${id}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Review', schema: REVIEW_SCHEMA },
    )

    if (review && review.ok) break
    log(`${id}: attempt ${attempts} failed review${attempts < 2 ? ', retrying' : ''}`)
  }

  return { id, dev, review, attempts, passed: Boolean(review && review.ok) }
}

// Serial on purpose: two agents running `git add` in one repository fight over
// index.lock, and every rule appends to the same rule-catalogue.ts.
async function landRule(result) {
  return agent(
    `You are the LAND agent for rule ${result.id}. Put it in the database, then commit it.

The point of this step is that a rule is either completely done or not started.
If we stop after you, the next session resumes cleanly.

1. Run 'just rules-sync'. It reads the code catalogue and writes the rule and
   rule_version rows. Report what it printed. If it did not add ${result.id},
   say so in problem and do not commit.
2. Run 'git status'. Stage only what belongs to ${result.id} — its rule file, its
   spec, and the one appended line in rule-catalogue.ts. Never 'git add -A'
   blindly, and never commit .env, local SQLite files or node_modules.
3. Commit with a real message: a subject line saying what the rule catches, and a
   body saying what it proposes and why. Reviewers read this history.
4. End the message with this trailer on its own line:
   Claude-Session: https://claude.ai/code/session_018JHzSKPA2wDXNE1yNyX843
5. Push to origin on the current branch. If the push is rejected, do NOT force,
   rebase, reset or checkout — report pushed=false with the exact error and stop.

What was built: ${result.dev ? result.dev.summary : ''}

Return the structured result.`,
    { label: `land:${result.id}`, phase: 'Land', schema: LAND_SCHEMA },
  )
}

const wanted = Array.isArray(args) && args.length ? args.map(String) : null
const selected = wanted ? RULES.filter((id) => wanted.includes(id)) : RULES

log(`${selected.length} rule${selected.length === 1 ? '' : 's'} to build`)

const done = []
let halted = null

for (const id of selected) {
  const result = await buildRule(id)
  done.push(result)

  if (!result.passed) {
    halted = `${id} did not pass review after ${result.attempts} attempt(s)`
    log(`HALT: ${halted}`)
    break
  }

  const landed = await landRule(result)
  result.landed = landed

  if (!landed || !landed.committed) {
    halted = `${id} was built but not committed: ${landed ? landed.problem : 'the land agent returned nothing'}`
    log(`HALT: ${halted}`)
    break
  }
}

return {
  rules: done.map((r) => ({
    id: r.id,
    passed: r.passed,
    attempts: r.attempts,
    ambiguous: r.dev ? r.dev.ambiguous : null,
    decided: r.dev ? r.dev.decided : [],
    unmet: r.review ? r.review.unmet : [],
    notes: r.review ? r.review.notes : [],
    sha: r.landed ? r.landed.sha : '',
  })),
  halted,
}
