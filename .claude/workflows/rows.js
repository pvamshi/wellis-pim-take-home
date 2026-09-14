export const meta = {
  name: 'rows',
  description: 'Build the rows screen (1.6): the dataset seen through the rows rather than the rules',
  whenToUse: 'To build notes/final-requirements.md §1.6. Pass task ids to do only those, e.g. args: ["R3"].',
  phases: [
    { title: 'Plan', detail: 'decide what the requirement leaves open, and record it', model: 'sonnet' },
    { title: 'Develop', detail: 'build the task and test it', model: 'sonnet' },
    { title: 'Review', detail: 'independent check against the requirement', model: 'sonnet' },
    { title: 'Land', detail: 'commit and push', model: 'sonnet' },
  ],
}

const REQS = 'notes/final-requirements.md'
const SECTION = `sed -n '/^## 1.6 The rows screen/,/^# Part B/p' ${REQS}`

// Facts already established in conversation that a fresh agent would otherwise
// get wrong, and the reasoning behind each. These are decided, not open.
const GROUND = `
You are building §1.6 of ${REQS}, the rows screen. Read the section with
exactly this command and read nothing else from that file:

  ${SECTION}

Also read §1.2.13 if your task touches an ambiguous finding:

  sed -n '/^### 1.2.13/,/^---/p' ${REQS}

Facts already decided. Do not re-open them:

- **A legacy id names a row but does not identify one** (1.0.3). Two legacy rows
  may share one. Findings are keyed by legacy id, so the screen's unit is the
  legacy id too — the same unit an approve already acts on. Where two data rows
  share an id, that is what the duplicate rules D01-D06 are for.
- **Rejection lives in its own table**, keyed (table, legacy_id), not as a
  column on the three legacy tables. \`legacy_patient.status\` already exists and
  is the *patient's* status out of the legacy system — active, paused, churned,
  the thing rules P55-P57 read. It is not ours to write.
- **Import pending and Import clean are never stored.** They are read off the
  findings on every request. Only rejection is stored.
- **A hand edit is written as a finding** under a reserved rule id, approved in
  the same transaction that writes the data, so the modification log (1.3) keeps
  one shape. \`catalogue-sync\` never deletes or deactivates a rule it has no code
  for, so a reserved rule row is safe to insert and will survive a sync.
- **Approve all skips ambiguous findings and reports the count it skipped.** An
  ambiguous rule proposes nothing, so there is no tick on it to press. Decline
  all covers everything, because the cross needs no proposal.

How this codebase is written:

- Services under \`apps/api/src/rules/\` own persistence and transactions;
  controllers under their own folder compose and validate. Follow that split.
- Validation is by hand — \`tech-stack.md\` names no validation library and one is
  not being introduced. Read \`apps/api/src/approve/approve.controller.ts\` for the
  pattern.
- Services do not throw HTTP exceptions; controllers do.
- \`apps/web/src/api/types.ts\` restates the backend's response types. If the two
  disagree, the web file is the bug. There are contract tests that read it.
- No frontend tests (tech-stack §4.7, deferred D1). Backend tests are Vitest
  against a temporary database — read \`apps/api/test/rules-list.spec.ts\`.
- Mantine core only. No icon package, no data-grid package.

- Do not run git commit, push, rebase, reset or checkout. A separate agent
  commits. Reading git state is fine.
- Never write to ${REQS} or notes/unresolved-questions.md.
`

const TASKS = [
  {
    id: 'R1',
    title: 'The rows list',
    detail: `The decision table and the list endpoint (1.6.1, 1.6.2).

- An entity for the stored decision, keyed (table, legacy_id), carrying the
  rejection and its reason. Registered like the other entities.
- A service that lists legacy rows with their state, computing pending and clean
  from the finding tables and reading rejection from the decision table.
- \`GET /rows\` with a state filter and a table filter. 2466 patients is the real
  size, so the list is paged or capped — decide which and say why.
- Tests: a row with a pending finding is pending, a row with none is clean, a
  rejected row is rejected whatever its findings say, and the filter returns
  exactly the rows of that state.`,
  },
  {
    id: 'R2',
    title: 'One row expanded',
    detail: `\`GET /rows/:table/:legacyId\` — everything waiting on one row (1.6.3).

- The row's own column values, and its findings grouped by the rule that made
  them, each with rule name, version, ambiguity, column, previous and next.
- Pending and already-settled findings are distinguishable, the way
  \`rule-detail.service.ts\` separates its two sections.
- Read \`apps/api/src/rules/rule-detail.service.ts\` first: this is its transpose,
  and the row shape it returns should be recognisably the same shape.
- Tests: a row with findings from several rules groups them correctly; a row
  with none returns its values and an empty list; an unknown row is a 404.`,
  },
  {
    id: 'R3',
    title: 'The row-wide presses',
    detail: `Approve all, decline all, reject and un-reject (1.6.4, 1.6.5, 1.6.6).

- \`POST /rows/:table/:legacyId/approve\` — every pending finding on that row that
  proposes a value, in one transaction (1.2.5). Ambiguous findings are skipped
  and counted. It must reuse \`RuleApprovalsService\`'s existing apply path, not
  re-implement it.
- \`POST /rows/:table/:legacyId/decline\` — every pending finding on that row,
  ambiguous included, declined forever (1.2.9), with an optional reason. It
  declines rows only: it never parks a rule version (1.2.8).
- \`POST /rows/:table/:legacyId/reject\` and \`/unreject\`, with an optional reason.
  Rejecting writes nothing to the legacy data, so it is reversible.
- Tests: approve all on a row with both kinds of finding writes the proposing
  ones and leaves the ambiguous ones pending with the right skipped count;
  decline all settles every one of them; a rejected row can be un-rejected.`,
  },
  {
    id: 'R4',
    title: 'A field corrected by hand',
    detail: `\`POST /rows/:table/:legacyId/edit\` (1.6.7).

- Writes one column of one legacy row to a supplied value, and in the same
  transaction records it as a finding: previous value, next value, approved.
- The finding carries a reserved rule id kept for exactly this. Insert that rule
  row if it is not there, with a name and description that read to a human in
  the console. It is not ambiguous and it has a version like any other.
- The column must be one the entity actually has — an unknown column is a 400,
  not a 500, and never a write.
- Tests: an edit writes the column and leaves a finding that names the reserved
  rule; the finding is approved and carries both values; an unknown column
  changes nothing; a second edit of the same column records a second finding
  rather than overwriting the first.`,
  },
  {
    id: 'R5',
    title: 'The screen',
    detail: `The page itself, at its own route beside the rules screen.

- A filterable list of rows with their state (1.6.1). The three states are named
  "Import pending", "Import clean" and "Import rejected" on screen.
- Expanding a row shows its findings grouped by rule, drawn with the existing
  \`ValueDiff\` component so before and after read the same as on the rules
  screen — do not write a second diff.
- Approve all and Decline all on the row, reporting what they did and what they
  skipped. Reject and un-reject. An edit form for any field.
- An ambiguous finding on this screen behaves as it does on the rules screen
  (1.2.13): a box for the value, not a tick. Reuse what
  \`RuleRowsTable.tsx\` already does rather than writing it again.
- \`apps/web/src/api/types.ts\` gets the new response types. \`client.ts\` gets the
  calls. Follow how the existing ones are written.
- No tests (deferred D1). Run \`just build\` and make it pass.`,
  },
]

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decisions: {
      type: 'array',
      items: { type: 'string' },
      description: 'What the requirement left open, decided, each with one line on why',
    },
    files: { type: 'array', items: { type: 'string' }, description: 'Files to add or change' },
    risks: { type: 'array', items: { type: 'string' }, description: 'What could break elsewhere' },
    plan: { type: 'string', description: 'What to build, in a paragraph or two' },
  },
  required: ['decisions', 'files', 'risks', 'plan'],
}

const DEV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    changed: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' }, description: 'Each as what it proves' },
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    departed: {
      type: 'array',
      items: { type: 'string' },
      description: 'Where the build departs from the plan, and why',
    },
    summary: { type: 'string' },
  },
  required: ['changed', 'tests', 'buildPassed', 'testsPassed', 'departed', 'summary'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true if it builds, tests pass, and it meets the requirement' },
    failures: { type: 'array', items: { type: 'string' } },
    unmet: { type: 'array', items: { type: 'string' }, description: 'Where it departs from §1.6' },
    weakTests: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' }, description: 'For a human. Never fatal.' },
  },
  required: ['ok', 'failures', 'unmet', 'weakTests', 'notes'],
}

const LAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    committed: { type: 'boolean' },
    sha: { type: 'string' },
    pushed: { type: 'boolean' },
    problem: { type: 'string' },
  },
  required: ['committed', 'sha', 'pushed', 'problem'],
}

async function buildTask(task) {
  const plan = await agent(
    `${GROUND}

You are the PLANNING agent for ${task.id} — ${task.title}. Decide, do not build.

${task.detail}

Read what already exists before deciding anything: the entities, the services
your task sits beside, and the endpoints that already do the single-row version
of what you are making a row-wide version of.

Your job is to settle what §1.6 does not say — a name, a shape, a paging
strategy, an error code — using what this codebase already does as the guide.
Decide; do not hand questions back. Say why for each.

Return the structured result.`,
    { label: `plan:${task.id}`, phase: 'Plan', schema: PLAN_SCHEMA, model: 'sonnet' },
  )

  let dev = null
  let review = null
  let attempts = 0

  while (attempts < 2) {
    attempts += 1

    const retry =
      attempts === 1
        ? ''
        : review
          ? `
This is attempt ${attempts}. A previous developer built this and it failed
review. Fix exactly what the reviewer found and nothing else.

Unmet: ${JSON.stringify(review.unmet)}
Failures: ${JSON.stringify(review.failures)}
Weak tests: ${JSON.stringify(review.weakTests)}
`
          : `
This is attempt ${attempts}. A previous developer worked on this and the
reviewer died before returning a verdict. Check what is on disk, finish or
correct it, and make 'just build' and 'just test' pass.
`

    dev = await agent(
      `${GROUND}

You are the DEVELOPMENT agent for ${task.id} — ${task.title}. Build it.

${task.detail}

The planning agent settled these:
${JSON.stringify(plan, null, 2)}

Follow the plan. Where you have to depart from it, do so and say where in
'departed' — the plan was written before the code was open.
${retry}
Run 'just build' and 'just test'. Report honestly: buildPassed and testsPassed
must be false if they are. A test you had to change to make pass is a finding,
not a fix — say so.

Return the structured result.`,
      { label: `dev:${task.id}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Develop', schema: DEV_SCHEMA, model: 'sonnet' },
    )

    review = await agent(
      `${GROUND}

You are the REVIEW agent for ${task.id} — ${task.title}. You did not write it.
Judge what is on disk, not what the developer claims.

What it was meant to be:
${task.detail}

1. Run 'just test'. Do not run 'just build' — the developer already did, and a
   type error fails the test run too. Fix nothing; report what fails.
2. Read the diff: 'git status' then 'git diff' for changed files, and read the
   new files whole.
3. Does it meet §1.6? Read the section yourself with the command above.
4. Are the tests real? A test that passes whether or not the code works is worse
   than none. Did the developer weaken an existing test to make it pass?
5. Did it write to a file it had no business in — another task's, a rule, a note?

ok is false only for a failing test, a departure from §1.6, or a weak test.
Anything else goes in notes.

What the developer says it did:
${JSON.stringify(dev)}

Return the structured result.`,
      { label: `review:${task.id}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'sonnet' },
    )

    if (review && review.ok) break
    log(`${task.id}: attempt ${attempts} failed review${attempts < 2 ? ', retrying' : ''}`)
  }

  return { task, plan, dev, review, attempts, passed: Boolean(review && review.ok) }
}

async function landTask(result) {
  return agent(
    `You are the LAND agent for ${result.task.id} — ${result.task.title}.

1. Run 'git status'. Stage only what belongs to this task. Never 'git add -A'
   blindly, and never commit .env, local SQLite files, node_modules or stray
   files at the repository root.
2. Commit with a real message: a subject line saying what now works that did
   not, and a body saying why it is built this way. Reviewers read this history.
   Name the requirement addresses it satisfies.
3. End the message with this trailer on its own line:
   Claude-Session: https://claude.ai/code/session_014bbzf54X89uCmtY7RsGV7H
4. Push to origin on the current branch. If the push is rejected, do NOT force,
   rebase, reset or checkout — report pushed=false with the exact error and stop.

What was built: ${result.dev ? result.dev.summary : ''}

Return the structured result.`,
    { label: `land:${result.task.id}`, phase: 'Land', schema: LAND_SCHEMA, model: 'sonnet' },
  )
}

const wanted = Array.isArray(args) && args.length ? args.map(String) : null
const selected = wanted ? TASKS.filter((task) => wanted.includes(task.id)) : TASKS

log(`${selected.length} task${selected.length === 1 ? '' : 's'}`)

const done = []
let halted = null

// Serial: every task touches the same modules and the same git index, and R5
// cannot be written against endpoints R1 to R4 have not built yet.
for (const task of selected) {
  const result = await buildTask(task)
  done.push(result)

  if (!result.passed) {
    halted = `${task.id} did not pass review after ${result.attempts} attempt(s)`
    log(`HALT: ${halted}`)
    break
  }

  const landed = await landTask(result)
  result.landed = landed

  if (!landed || !landed.committed) {
    halted = `${task.id} was built but not committed: ${landed ? landed.problem : 'the land agent returned nothing'}`
    log(`HALT: ${halted}`)
    break
  }

  log(`landed ${task.id}`)
}

return {
  tasks: done.map((r) => ({
    id: r.task.id,
    passed: r.passed,
    attempts: r.attempts,
    decisions: r.plan ? r.plan.decisions : [],
    departed: r.dev ? r.dev.departed : [],
    unmet: r.review ? r.review.unmet : [],
    notes: r.review ? r.review.notes : [],
    sha: r.landed ? r.landed.sha : '',
  })),
  halted,
}
