export const meta = {
  name: 'duplicates',
  description: 'Complete duplicate handling (1.7): record links, confirm or dismiss them, merge, retire X',
  whenToUse: 'To build notes/final-requirements.md §1.7. Pass task ids to do only those, e.g. args: ["U3"].',
  phases: [
    { title: 'Plan', detail: 'decide what the requirement leaves open', model: 'sonnet' },
    { title: 'Develop', detail: 'build the task and test it', model: 'sonnet' },
    { title: 'Review', detail: 'independent check against the requirement', model: 'sonnet' },
    { title: 'Land', detail: 'sync the rules, commit and push', model: 'sonnet' },
  ],
}

const REQS = 'notes/final-requirements.md'
const SECTION = `sed -n '/^## 1.7 Duplicates/,/^# Part B/p' ${REQS}`

const GROUND = `
You are building §1.7 of ${REQS}, duplicate handling. Read the section with
exactly this command, and 1.1.13 with the second; read nothing else from that file:

  ${SECTION}
  sed -n '/^### 1.1.13/,/^---/p' ${REQS}

What already exists — read it before deciding anything:

- \`apps/api/src/duplicates/duplicate.entity.ts\` — the \`duplicate\` table. No row
  ids, no status, no uniqueness yet. It has 0 rows: nothing has ever written it.
- \`apps/api/src/rules/rule-contract.ts\` — \`RuleResponse.duplicates?:
  DuplicateFinding[]\`. Rules already return links there.
- \`apps/api/src/rules/catalogue/d01.ts\` … \`d06.ts\` — the six duplicate rules, v1.
  D05 and D06 set duplicateLegacyId === canonicalLegacyId, which identifies
  nothing. That is the bug 1.7.1 fixes.
- \`apps/api/src/rules/rule-findings.service.ts\` — \`persist()\` writes a run's
  findings in one transaction and ignores \`duplicates\` entirely. That is the gap.
- \`apps/api/src/rows/row-rejections.service.ts\` — rejecting a row, used by 1.7.5.
- \`apps/api/src/rules/catalogue/p01.ts\` — the shape and length of a rule.
- \`apps/web/src/components/ValueDiff.tsx\`, \`apps/web/src/pages/RowsPage.tsx\` —
  the diff drawing and the virtualised accordion list to reuse.

Facts already decided:

- A new rule version is new code under a new key; the old file stays and stays
  registered (1.1.8). \`just rules-sync\` activates the highest version.
- A rule writes nothing (1.1.2); \`persist()\` is the only writer of findings, and
  now of links.
- Declined rows are keyed ignoring version (1.2.9); dismissed links mirror that.

How this codebase is written:

- Services under \`apps/api/src/rules/\` or their module own persistence and
  transactions; controllers compose and validate by hand; services throw no HTTP
  exceptions. Read \`apps/api/src/approve/approve.controller.ts\`.
- \`apps/web/src/api/types.ts\` restates backend response types; contract tests
  read it. If the two disagree, the web file is the bug.
- Backend tests: Vitest against a temporary database — read
  \`apps/api/test/rules-list.spec.ts\`. No frontend tests (deferred D1).
- Mantine core, \`@tanstack/react-virtual\`. No other UI packages.
- Doc comments short: what, why, and nothing the code already says.

- Do not run git commit, push, rebase, reset or checkout. A separate agent commits.
- Never write to notes/.
`

const TASKS = [
  {
    id: 'U1',
    title: 'Record duplicate links',
    detail: `1.7.1, 1.7.2, 1.7.3.

- \`duplicate\` gains the two data-row ids, a status (\`pending\` · \`confirmed\` ·
  \`dismissed\`) and uniqueness on the pair of rows within a source.
- \`DuplicateFinding\` gains optional \`duplicateRowId\` and \`canonicalRowId\` —
  optional so the v1 rule files still compile.
- \`persist()\` records every link of the run in the same transaction as the
  findings: skips a pair already linked in any status (so a dismissed link is
  never re-recorded), and fails the run on a link missing a row id.
- Its report counts links found, recorded and skipped.
- Tests: a link is recorded pending; a second run records nothing; a dismissed
  pair found again by a different rule records nothing; a link without row ids
  fails the run and writes no finding either.`,
  },
  {
    id: 'U2',
    title: 'D01–D06 v2 naming both rows',
    detail: `1.7.1.

- A v2 file beside each of d01.ts … d06.ts (e.g. \`d01-v2.ts\`), version 2, same
  rule id, same catch, now filling \`duplicateRowId\` and \`canonicalRowId\` with
  the legacy data rows' own \`id\`. D05 and D06 link two distinct rows.
- Append all six to \`rule-catalogue.ts\`; leave the v1 entries in place.
- One spec per v2 rule asserting the exact links, including row ids, and for D05
  and D06 that X and Y are different rows.`,
    sync: true,
  },
  {
    id: 'U3',
    title: 'Confirm and dismiss',
    detail: `1.7.4 (API only), 1.7.5, 1.7.6.

- \`GET /duplicates\` filterable by status and source; \`GET /duplicates/:id\` with
  both rows' column values; \`POST /duplicates/:id/confirm\`;
  \`POST /duplicates/:id/dismiss\`.
- Confirm on a patient link, in one transaction: link → confirmed, and X rejected
  through \`row-rejections\` with a reason naming Y's legacy id and the rule.
- Confirm on an intake or consent link: link → confirmed only.
- Only a pending link can be confirmed or dismissed: 409 otherwise.
- Tests: each of the above, including that confirming a patient link leaves X
  Import rejected on \`GET /rows\`, and that intake/consent confirmation rejects
  nothing.`,
  },
  {
    id: 'U4',
    title: 'Merge rules M01–M07',
    detail: `1.7.7. Read the Merges section of notes/rule-catalogue.md.

- Seven v1 rules, one per column, reading confirmed patient links and proposing
  X's value for Y's empty column. Findings on Y; not ambiguous.
- Y with two confirmed duplicates holding different values for the column
  proposes nothing for that row.
- Append all seven to \`rule-catalogue.ts\`.
- One spec per rule: fills an empty column; leaves a filled one alone; ignores a
  pending or dismissed link; proposes nothing on conflicting duplicates.`,
    sync: true,
  },
  {
    id: 'U5',
    title: 'The duplicates screen',
    detail: `1.7.4.

- A route and nav link beside Rules and Rows.
- Virtualised list with status and source filters, pending by default.
- Expanding a link shows X and Y side by side, every column, drawn with
  \`ValueDiff\` so differences and invisible characters show.
- Confirm and Dismiss on pending links; report what the press did and re-read.
- Types in \`types.ts\`, calls in \`client.ts\`, following the existing ones.
- Run \`just build\` and make it pass.`,
  },
]

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decisions: { type: 'array', items: { type: 'string' }, description: 'What the requirement left open, decided, each with one line on why' },
    files: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    plan: { type: 'string' },
  },
  required: ['decisions', 'files', 'risks', 'plan'],
}

const DEV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    changed: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' } },
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    departed: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['changed', 'tests', 'buildPassed', 'testsPassed', 'departed', 'summary'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    unmet: { type: 'array', items: { type: 'string' } },
    weakTests: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'failures', 'unmet', 'weakTests', 'notes'],
}

const LAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    synced: { type: 'boolean' },
    committed: { type: 'boolean' },
    sha: { type: 'string' },
    pushed: { type: 'boolean' },
    problem: { type: 'string' },
  },
  required: ['synced', 'committed', 'sha', 'pushed', 'problem'],
}

async function buildTask(task) {
  const plan = await agent(
    `${GROUND}

You are the PLANNING agent for ${task.id} — ${task.title}. Decide, do not build.

${task.detail}

Settle what §1.7 does not say, using what the codebase already does as the guide.
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
Attempt ${attempts}. It failed review. Fix exactly what the reviewer found.

Unmet: ${JSON.stringify(review.unmet)}
Failures: ${JSON.stringify(review.failures)}
Weak tests: ${JSON.stringify(review.weakTests)}
`
          : `
Attempt ${attempts}. The reviewer died before a verdict. Check what is on disk,
finish or correct it, and make 'just build' and 'just test' pass.
`

    dev = await agent(
      `${GROUND}

You are the DEVELOPMENT agent for ${task.id} — ${task.title}. Build it.

${task.detail}

The planning agent settled these:
${JSON.stringify(plan, null, 2)}

Where you depart from the plan, say where in 'departed'.
${retry}
Run 'just build' and 'just test'. Report honestly. A test you had to change to
make pass is a finding, not a fix — say so.

Return the structured result.`,
      { label: `dev:${task.id}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Develop', schema: DEV_SCHEMA, model: 'sonnet' },
    )

    review = await agent(
      `${GROUND}

You are the REVIEW agent for ${task.id} — ${task.title}. You did not write it.
Judge what is on disk, not what the developer claims.

What it was meant to be:
${task.detail}

1. Run 'just test'. Fix nothing; report what fails.
2. Read the diff: 'git status', 'git diff', and new files whole.
3. Does it meet §1.7? Read the section yourself.
4. Are the tests real? Did the developer weaken an existing test?
5. Did it touch a file it had no business in?

ok is false only for a failing test, a departure from §1.7, or a weak test.
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
  const sync = result.task.sync
    ? `1. Run 'just rules-sync' and report what it printed. If it did not add the new
   rule versions, say so in problem and do not commit.`
    : `1. No rules changed in this task; set synced true without running anything.`

  return agent(
    `You are the LAND agent for ${result.task.id} — ${result.task.title}.

${sync}
2. Run 'git status'. Stage only what belongs to this task. Never 'git add -A'
   blindly; never commit .env, local SQLite files, node_modules or stray files at
   the repository root.
3. Commit with a subject saying what now works that did not, and a short body
   saying why it is built this way. Name the requirement addresses.
4. End the message with this trailer on its own line:
   Claude-Session: https://claude.ai/code/session_014bbzf54X89uCmtY7RsGV7H
5. Push to origin on the current branch. If rejected, do NOT force, rebase, reset
   or checkout — report pushed=false with the exact error and stop.

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

// Serial: U2 and U4 register rules against the contract U1 changes, U3 confirms
// links U1 records, and U5 draws what U3 serves.
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
