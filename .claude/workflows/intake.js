export const meta = {
  name: 'intake',
  description: 'Build Part B (notes/intake-requirements.md): main table, intake, eligibility, review, legacy import',
  whenToUse: 'To build notes/intake-requirements.md. Pass task ids to do only those, e.g. args: ["B4"].',
  phases: [
    { title: 'Develop', detail: 'build the task and test it', model: 'sonnet' },
    { title: 'Review', detail: 'independent check against the spec', model: 'sonnet' },
    { title: 'Land', detail: 'commit and push', model: 'sonnet' },
  ],
}

const SPEC = 'notes/intake-requirements.md'

// One command per spec node, so an agent reads only the nodes its task names.
function node(address) {
  return `sed -n '/^## ${address} /,/^## /p' ${SPEC}`
}

// No planning agent: the spec already decides column types, transitions,
// question wording, error shapes and endpoints, which is what planning agents
// were deciding on the earlier workflows.
const GROUND = `
You are building Part B of this project. ${SPEC} is the contract. It is compact
on purpose: every table, transition, question, rule, error shape and endpoint in
it is decided. Do not re-open any of it.

Always read §2.0:
  ${node('2.0')}

What already exists and how it is written — read what your task touches:

- \`apps/api/src/app.module.ts\` — module wiring. TypeORM runs with
  \`synchronize: true\` and there are no migrations, so schema comes from entities
  and triggers are created on boot (\`CREATE TRIGGER IF NOT EXISTS\`).
- \`apps/api/src/approve/approve.controller.ts\` — hand-written request
  validation. No validation library is used; do not add one.
- Services own transactions and throw no HTTP exceptions; controllers map
  outcomes to status codes.
- \`apps/api/src/legacy/*.entity.ts\` — the legacy tables.
- \`apps/api/src/rules/row-list.service.ts\`, \`row-rejections.service.ts\` — the
  rows screen's states and rejections.
- \`apps/api/src/duplicates/duplicate.entity.ts\` — links, with \`status\` and row ids.
- Tests: Vitest against a temporary database. Read
  \`apps/api/test/rules-list.spec.ts\` and \`apps/api/test/temp-database.ts\`.
- \`apps/web/src/api/types.ts\` restates backend response types and contract
  specs read it; \`client.ts\` holds every call. If the two disagree with the
  backend, the web file is the bug.
- \`apps/web/src/pages/RowsPage.tsx\` — virtualised list pattern.
  \`apps/web/src/components/ValueDiff.tsx\` — draws values with invisible
  characters shown. \`AppNav.tsx\`, \`App.tsx\` — routes and nav.
- Mantine core, \`@mantine/form\`, \`@tanstack/react-virtual\`. Nothing else for UI.
- No frontend tests (deferred D1).
- Doc comments short: what and why, nothing the code already says.

- Do not run git commit, push, rebase, reset or checkout. A separate agent commits.
- Never write to notes/.
`

const TASKS = [
  {
    id: 'B1',
    title: 'Main table, state machine, audit log',
    nodes: ['2.1', '2.2', '2.8'],
    detail: `- Entities \`patient\`, \`consent_event\`, \`audit_event\` exactly as specified,
  with every CHECK constraint.
- Boot-time triggers: the \`intake_status\` update and insert rules of §2.2, and
  append-only \`audit_event\`.
- \`INTAKE_TRANSITIONS\` and \`IntakeStateMachine.transition()\` — the conditional
  UPDATE and its audit event in one transaction; 0 rows → a result the
  controller turns into 409.
- An audit writer used inside callers' transactions.
- Tests: every illegal pair fails through the service and through raw SQL; a
  legal transition writes exactly one audit event; UPDATE and DELETE on
  audit_event raise; an insert with a status the origin does not allow raises.`,
  },
  {
    id: 'B2',
    title: 'Validators and eligibility engine',
    nodes: ['2.5', '2.7'],
    detail: `- Backend validators per questionnaire step, for full submission, and for
  legacy import (identity and body rules; medication and health may be null).
  Every error collected, returned as \`{ field, value, reason }\`.
- Eligibility registry with \`elig-1\` as code; \`ACTIVE_RULESET\`; \`evaluate()\`
  returning every rule's result and the outcome.
- Tests: each rule matched and not matched with its exact explanation; BMI 26.96
  rounds to 27.0 and is not rejected; age on the birthday is reached; a null
  answer a rule needs flags with the "not recorded (legacy)" explanation;
  precedence reject > flag > clear; every validator rule's boundary.`,
  },
  {
    id: 'B3',
    title: 'Intake and review API',
    nodes: ['2.3', '2.4', '2.9'],
    detail: `- \`POST /intakes\`, \`PATCH /intakes/:id\`, \`POST /intakes/:id/submit\`,
  \`GET /intakes/:id\` — using B1's state machine and B2's validators and engine.
  Consent step writes \`consent_event granted\`.
- \`GET /review/intakes\` (status and origin filters), \`GET /review/intakes/:id\`
  (answers, evaluation, audit history), \`POST .../start\`, \`POST .../decide\`
  with a required trimmed note.
- Tests: two drafts may share an email; submitting with an email a non-draft
  patient holds → 409 with a field error on email and nothing written; patching
  a submitted row → 409; submit stores the
  evaluation and writes draft→submitted and submitted→auto_* audit events;
  decide without a note → 422; start on a non-auto status → 409; the queue's
  default filter.`,
  },
  {
    id: 'B4',
    title: 'Legacy import, individual and bulk',
    nodes: ['2.6'],
    detail: `- \`POST /rows/patient/:legacyId/import\` and \`POST /rows/import\` exactly as
  §2.6: preconditions, one transaction per row, mapping, consent events, B2's
  evaluation, audit events.
- Imported becomes a fourth state in \`row-list.service.ts\` with the stated
  precedence; findings are no longer recorded against an imported patient row.
- Tests: a clean row imports and lands auto_flagged or auto_rejected, never
  auto_cleared; its consent events come along minus confirmed duplicate rows;
  invalid data returns every field error and writes nothing; a taken email is a
  field error, not a 500; bulk with one bad row imports the others; each
  precondition → 409; the rows list shows Imported.`,
  },
  {
    id: 'B5',
    title: 'Intake form',
    nodes: ['2.3', '2.5'],
    detail: `- Install \`@mantine/form\` in apps/web.
- Routes \`/intake\`, \`/intake/:id/:step\`, \`/intake/:id/done\`, without staff nav.
- The six steps and their exact questions, per-step validation with
  \`@mantine/form\`, Next blocked until valid, PATCH per step, resume by id,
  read-only after submit, neutral "received" page.
- Types and calls in \`types.ts\` and \`client.ts\`.
- Run 'just build' and make it pass.`,
  },
  {
    id: 'B6',
    title: 'Review screen',
    nodes: ['2.4'],
    detail: `- Routes \`/review\` and \`/review/:id\`, and a nav link.
- Virtualised queue with status and origin filters; detail with answers by step
  (not-recorded marked), every rule result, audit history.
- Start review, Approve, Reject; note required; reviewer name kept in localStorage.
- Run 'just build' and make it pass.`,
  },
  {
    id: 'B7',
    title: 'Import on the rows screen',
    nodes: ['2.6'],
    detail: `- An Import button on each Import clean patient row.
- A checkbox on each Import clean patient row, a select-all over the loaded clean
  patient rows, and Import selected.
- After a press: imported rows leave the selection; failed rows stay selected
  and list each field, its value drawn with \`ValueDiff\`, and the reason.
- The Imported state in the state filter and badge.
- Run 'just build' and make it pass.`,
  },
]

// One develop → review → land cycle per batch, not per task: each cycle pays
// for a full read-in of the codebase and a build and test run in every agent,
// so seven cycles cost more than twice what three do. Batches follow the seams
// where one layer is finished before the next reads it.
const BATCHES = [
  ['B1', 'B2'],
  ['B3', 'B4'],
  ['B5', 'B6', 'B7'],
]

function batchTask(tasks) {
  return {
    id: tasks.map((task) => task.id).join('+'),
    title: tasks.map((task) => `${task.id} ${task.title}`).join('; '),
    nodes: [...new Set(tasks.flatMap((task) => task.nodes))],
    detail: tasks.map((task) => `${task.id} — ${task.title}\n${task.detail}`).join('\n\n'),
  }
}

const DEV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    changed: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' } },
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    departed: { type: 'array', items: { type: 'string' }, description: 'Where the build departs from the spec, and why' },
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
    committed: { type: 'boolean' },
    sha: { type: 'string' },
    pushed: { type: 'boolean' },
    problem: { type: 'string' },
  },
  required: ['committed', 'sha', 'pushed', 'problem'],
}

function nodeCommands(task) {
  return task.nodes.map((address) => `  ${node(address)}`).join('\n')
}

async function buildTask(task) {
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

Read these spec nodes:
${nodeCommands(task)}

${task.detail}
${retry}
Where the spec is silent, decide in the codebase's own style and say so in
'departed'. Run 'just build' and 'just test'. Report honestly. A test you had to
change to make pass is a finding, not a fix — say so.

Return the structured result.`,
      { label: `dev:${task.id}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Develop', schema: DEV_SCHEMA, model: 'sonnet' },
    )

    review = await agent(
      `${GROUND}

You are the REVIEW agent for ${task.id} — ${task.title}. You did not write it.
Judge what is on disk, not what the developer claims.

The spec nodes it must meet:
${nodeCommands(task)}

What it was meant to be:
${task.detail}

1. Run 'just test'. Fix nothing; report what fails.
2. Read the diff: 'git status', 'git diff', and new files whole.
3. Does it meet the spec nodes? Read them yourself.
4. Are the tests real? Did the developer weaken an existing test?
5. Did it touch a file it had no business in?

ok is false only for a failing test, a departure from the spec, or a weak test.
Anything else goes in notes.

What the developer says it did:
${JSON.stringify(dev)}

Return the structured result.`,
      { label: `review:${task.id}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'sonnet' },
    )

    if (review && review.ok) break
    log(`${task.id}: attempt ${attempts} failed review${attempts < 2 ? ', retrying' : ''}`)
  }

  return { task, dev, review, attempts, passed: Boolean(review && review.ok) }
}

async function landTask(result) {
  return agent(
    `You are the LAND agent for ${result.task.id} — ${result.task.title}.

1. Run 'git status'. Stage only what belongs to this task, including
   package.json and package-lock.json if a dependency was added. Never
   'git add -A' blindly; never commit .env, local SQLite files, node_modules or
   stray files at the repository root.
2. Commit with a subject saying what now works that did not, and a short body
   saying why it is built this way. Name the spec addresses (${result.task.nodes.join(', ')}).
3. End the message with this trailer on its own line:
   Claude-Session: https://claude.ai/code/session_014bbzf54X89uCmtY7RsGV7H
4. Push to origin on the current branch. If rejected, do NOT force, rebase, reset
   or checkout — report pushed=false with the exact error and stop.

What was built: ${result.dev ? result.dev.summary : ''}

Return the structured result.`,
    { label: `land:${result.task.id}`, phase: 'Land', schema: LAND_SCHEMA, model: 'sonnet' },
  )
}

const wanted = Array.isArray(args) && args.length ? args.map(String) : null
const selected = BATCHES
  .map((ids) => TASKS.filter((task) => ids.includes(task.id) && (!wanted || wanted.includes(task.id))))
  .filter((tasks) => tasks.length)
  .map(batchTask)

log(`${selected.length} batch${selected.length === 1 ? '' : 'es'}: ${selected.map((batch) => batch.id).join(', ')}`)

const done = []
let halted = null

// Serial: each batch builds on the one before, and two agents running the test
// suite at once would each see the other's half-written code.
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
    departed: r.dev ? r.dev.departed : [],
    unmet: r.review ? r.review.unmet : [],
    notes: r.review ? r.review.notes : [],
    sha: r.landed ? r.landed.sha : '',
  })),
  halted,
}
