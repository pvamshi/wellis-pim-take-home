export const meta = {
  name: 'rules',
  description: 'Implement the rule catalogue in batches: develop, review, commit, sync',
  whenToUse: 'To work through notes/rule-catalogue.md. Pass rule ids to do only those, e.g. args: ["P31","P32"].',
  phases: [
    { title: 'Develop', detail: 'write a batch of rules, register them, test them', model: 'sonnet' },
    { title: 'Review', detail: 'independent check of the batch diff against the catalogue', model: 'sonnet' },
    { title: 'Land', detail: 'sync the database, then one commit per rule', model: 'sonnet' },
  ],
}

const CATALOGUE = 'notes/rule-catalogue.md'
const DEFER = 'notes/deferred.md'

// How many rules one developer context builds. Bigger amortises the ground
// rules, the example and the warm-up across more rules; smaller loses less work
// when a batch fails review. A batch is the resume unit: land commits each rule
// separately, so an interrupted run resumes at the start of the batch it died in.
const BATCH_SIZE = 6

// The whole of what a rule must obey, written out here so no agent opens
// notes/final-requirements.md to find it. These six are the only requirements
// that bind rule code.
const REQUIREMENTS = `
1.1.2  A rule writes nothing. The context has find() and query() and nothing else.
1.1.4  Atomic — one rule, one fix. A fix may span several columns of the same row
       when neither alone leaves the row right; it may never be two fixes.
1.1.5  Same column — a rule changes the column it tested.
1.1.7  Field-shaped — a finding is (table, legacyId, column, prev, next).
1.1.12 Ambiguity is rule-wide — one flag for the whole response, never per row.
       An ambiguous rule sets every next to null and explains itself in
       'description'; a human reads that instead of a proposed value.
1.1.14 Called once — read whole tables, return every change in one batch.
`

// A whole rule, inline, so no agent spends a read opening an existing one to
// learn the shape. It is also the length benchmark: this is what a rule looks
// like, comment included.
const EXAMPLE = `
import { LegacyPatient } from '../../legacy/legacy-patient.entity';
import type { CatalogueRule, RuleContext, RuleResponse } from '../rule-contract';

/**
 * P01 — a patient's \`legacy_id\` with whitespace around it. Proposes the
 * trimmed id.
 *
 * Not ambiguous: padding is the spreadsheet's, not part of the id, so trimming
 * reads the cell rather than guessing at it. An id that trims away to nothing
 * is P02's finding, not this one's — this rule proposes an id, and an empty
 * string is not one.
 *
 * Tests \`legacy_id\` and changes \`legacy_id\` (1.1.5), and the trimmed value
 * has no padding left, so an approved row does not match on the next run.
 */
export const p01: CatalogueRule = {
  ruleId: 'P01',
  version: 1,
  ruleName: 'Patient legacy id has whitespace around it',
  description:
    "This patient's legacy id has spaces around it. The trimmed id is proposed: the " +
    'same id, with the padding the old export left on it removed, so it matches the ' +
    'id every other table refers to it by.',
  ambiguous: false,

  run: async (context: RuleContext): Promise<RuleResponse> => {
    const patients = await context.find(LegacyPatient);
    const updates = [];

    for (const patient of patients) {
      const previous = patient.legacyPatientId;
      if (previous === null) continue;

      const next = previous.trim();

      // Nothing left to address the row by. P02's finding, not this one's.
      if (next.length === 0) continue;

      // No padding. Proposing the same value back is a change with nothing in
      // it, and the row would match again on every run.
      if (next === previous) continue;

      updates.push({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'legacy_id',
        prev: previous,
        next,
      });
    }

    return { ambiguity: false, updates };
  },
};
`

const GROUND_RULES = `
Ground rules for every agent in this workflow:

- ${CATALOGUE} holds each rule: its id, the column it is on, what it catches,
  what it proposes, and whether it is ambiguous (the ✱ column). That entry is
  the contract. Read ONLY the rows you were given — the command below prints
  them and the headings that say which table and column they are on. Never read
  the whole file.
- ${DEFER} is what was cut on purpose. Never build it back. Do not read it
  unless a rule looks like it might be in it.
- Do NOT open notes/final-requirements.md. Everything binding is here:
${REQUIREMENTS}
- Never write to any file under notes/.

How a rule is added:
- One file per rule under apps/api/src/rules/catalogue/, named for the rule id.
- It exports a CatalogueRule: ruleId, version 1, ruleName, description,
  ambiguous, and run.
- It is appended to ruleCatalogue in apps/api/src/rules/rule-catalogue.ts, with
  its import. Entries are appended, never reordered and never removed.
- 'description' is what a human reads in the console, so write it as a sentence
  about this row's problem, not as a note to a developer. For an ambiguous rule
  it is the whole explanation, since there is no proposed value to show.

This is the shape, and the length. Follow it:
${EXAMPLE}

Length budget. It is a real constraint, not a suggestion:
- The doc comment above the rule is AT MOST 15 lines. It must say: what the
  rule catches, what it proposes, why the ambiguity flag is what it is, where
  the boundary is against the neighbouring rules on the same column, and why an
  approved row stops matching. One line each. No enumerated case-by-case essay
  — the code says what the cases are.
- Inline comments only where the code would otherwise read as arbitrary.
- The spec is AT MOST 80 lines.
Say each thing once. Restating a decision in three paragraphs is the failure.

Tests:
- One spec per rule, against a temporary database with fixture rows.
- It must prove the rule catches what the catalogue says it catches, proposes
  the exact value the catalogue says, leaves the neighbouring cases alone, and
  returns the right ambiguity flag.
- Assert the proposed value, never only that the rule fired.
- Few fixtures, each earning its place. One fixture per distinct behaviour.

- Do not run git commit, git push, git rebase, git reset or git checkout. A
  separate agent commits. Reading git state is fine.
- Do not touch any rule you were not given.
`

const DEV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          ruleName: { type: 'string' },
          ambiguous: { type: 'boolean' },
          summary: { type: 'string', description: 'One sentence: what it catches and what it proposes' },
        },
        required: ['id', 'ruleName', 'ambiguous', 'summary'],
      },
    },
    buildPassed: { type: 'boolean' },
    testsPassed: { type: 'boolean' },
    decided: {
      type: 'array',
      items: { type: 'string' },
      description: 'Choices made where a catalogue entry was silent, each one line, prefixed with the rule id',
    },
  },
  required: ['rules', 'buildPassed', 'testsPassed', 'decided'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true only if every rule in the batch passes' },
    testsPassed: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    unmet: {
      type: 'array',
      items: { type: 'string' },
      description: 'Each prefixed with the rule id: where it departs from its catalogue entry or breaks a requirement',
    },
    weakTests: { type: 'array', items: { type: 'string' }, description: 'Each prefixed with the rule id' },
    notes: { type: 'array', items: { type: 'string' }, description: 'Anything a human should look at. Never fatal.' },
  },
  required: ['ok', 'testsPassed', 'failures', 'unmet', 'weakTests', 'notes'],
}

const LAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    synced: { type: 'boolean', description: 'true if just rules-sync added every rule in the batch' },
    syncReport: { type: 'string' },
    committed: { type: 'array', items: { type: 'string' }, description: 'Rule ids committed' },
    pushed: { type: 'boolean' },
    problem: { type: 'string' },
  },
  required: ['synced', 'syncReport', 'committed', 'pushed', 'problem'],
}

// Every rule in the catalogue, in the order it appears there. Not a priority
// order — the catalogue says so itself.
const RULES = [
  ...Array.from({ length: 65 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 38 }, (_, i) => `I${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 13 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 6 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`),
]

// One grep that prints every heading in the catalogue plus only the rows this
// batch needs, so the agent sees which table and column each row sits under
// without reading 330 lines to find out.
function catalogueCommand(ids) {
  return `grep -nE '^(#{2,3} |\\| (${ids.join('|')}) \\|)' ${CATALOGUE}`
}

function lowerFile(id) {
  return id.toLowerCase()
}

async function buildBatch(ids) {
  let dev = null
  let review = null
  let attempts = 0

  const files = ids.map((id) => `apps/api/src/rules/catalogue/${lowerFile(id)}.ts`).join(' ')
  const specs = ids.map((id) => `test/rule-${lowerFile(id)}.spec.ts`).join(' ')

  while (attempts < 2) {
    attempts += 1

    const retry =
      attempts === 1
        ? ''
        : review
          ? `
This is attempt ${attempts}. A previous developer built these and review failed.
Fix exactly what the reviewer found and nothing else. Leave the rules it did not
name alone.

Unmet: ${JSON.stringify(review.unmet)}
Failures: ${JSON.stringify(review.failures)}
Weak tests: ${JSON.stringify(review.weakTests)}
`
          : `
This is attempt ${attempts}. A previous developer worked on these and the
reviewer died before returning a verdict, so nothing is known about what is
wrong. Check what is already on disk for these rules, finish or correct it, and
make 'just build' and 'just test' pass.
`

    dev = await agent(
      `${GROUND_RULES}

You are the DEVELOPMENT agent for rules ${ids.join(', ')}. Write all of them.

Get their catalogue entries with exactly this command, and read nothing else
from that file:

  ${catalogueCommand(ids)}

Build exactly those rules — the column each names, the problem it names, the fix
it names, and its ambiguity marking. Nothing wider. Rules on the same column are
deliberately separate: each does one thing and hands the rest on.

Write all ${ids.length} rule files and all ${ids.length} specs, then register
them in rule-catalogue.ts in one edit.
${retry}
While iterating run only this batch's specs:
  npm run test -w apps/api -- ${specs}
Then run 'just build' and 'just test' ONCE at the end. Report honestly —
buildPassed and testsPassed must be false if they are.

Return the structured result.`,
      { label: `dev:${ids[0]}-${ids[ids.length - 1]}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Develop', schema: DEV_SCHEMA, model: 'sonnet' },
    )

    review = await agent(
      `${GROUND_RULES}

You are the REVIEW agent for rules ${ids.join(', ')}. You did not write them.
Judge what is on disk, not what the developer claims.

Read the work as a diff, not as whole files:
  git diff -- apps/api/src/rules/rule-catalogue.ts
  cat ${files}
  cat ${specs.split(' ').map((s) => `apps/api/${s}`).join(' ')}

Get the catalogue entries with exactly this command:
  ${catalogueCommand(ids)}

1. Run 'just test'. Do not run 'just build' — the developer already did, and a
   type error fails the test run too. Fix nothing; report what fails.
2. For each rule: does it catch what its entry says, and propose exactly what its
   entry says? Does its ambiguity flag match the ✱ column?
3. Check the binding requirements listed above, per rule.
4. Are the tests real? A test that passes whether or not the rule works is worse
   than no test. Check each asserts the proposed value, not just that it fired.
5. Is the doc comment within 15 lines and the spec within 80? Over-length is a
   note, not a failure — say so and move on.

ok is false only for a failing test, a departure from a catalogue entry, a
broken requirement, or a weak test. Anything else goes in notes.

What the developer says it did:
${JSON.stringify(dev)}

Return the structured result.`,
      { label: `review:${ids[0]}-${ids[ids.length - 1]}${attempts > 1 ? `#${attempts}` : ''}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'sonnet' },
    )

    if (review && review.ok) break
    log(`${ids[0]}-${ids[ids.length - 1]}: attempt ${attempts} failed review${attempts < 2 ? ', retrying' : ''}`)
  }

  return { ids, dev, review, attempts, passed: Boolean(review && review.ok) }
}

// Serial on purpose: two agents running `git add` in one repository fight over
// index.lock, and every batch appends to the same rule-catalogue.ts.
async function landBatch(result) {
  const summaries = result.dev ? result.dev.rules.map((r) => `${r.id}: ${r.summary}`).join('\n') : ''

  return agent(
    `You are the LAND agent for rules ${result.ids.join(', ')}. Put them in the
database, then commit them one at a time.

The point of this step is that a rule is either completely done or not started.
If we stop after you, the next session resumes cleanly.

1. Run 'just rules-sync' ONCE. It reads the code catalogue and writes the rule
   and rule_version rows. Report what it printed. If it did not add every rule
   in this batch, say so in problem and do not commit.
2. Run 'git status'. Commit ONE RULE AT A TIME, in order: for each rule, stage
   its rule file, its spec, and commit. Stage rule-catalogue.ts with the LAST
   rule only — its registrations are one edit and cannot be split. Never
   'git add -A', and never commit .env, local SQLite files, node_modules or
   stray files at the repository root.
3. Each message: a subject line saying what that rule catches, and a short body
   saying what it proposes and why. Two or three sentences. Reviewers read this
   history.
4. End every message with this trailer on its own line:
   Claude-Session: https://claude.ai/code/session_014bbzf54X89uCmtY7RsGV7H
5. Push to origin on the current branch ONCE, after the last commit. If the push
   is rejected, do NOT force, rebase, reset or checkout — report pushed=false
   with the exact error and stop.

What was built:
${summaries}

Return the structured result.`,
    { label: `land:${result.ids[0]}-${result.ids[result.ids.length - 1]}`, phase: 'Land', schema: LAND_SCHEMA, model: 'sonnet' },
  )
}

const wanted = Array.isArray(args) && args.length ? args.map(String) : null
const selected = wanted ? RULES.filter((id) => wanted.includes(id)) : RULES

const batches = []
for (let i = 0; i < selected.length; i += BATCH_SIZE) {
  batches.push(selected.slice(i, i + BATCH_SIZE))
}

log(`${selected.length} rules in ${batches.length} batch${batches.length === 1 ? '' : 'es'} of up to ${BATCH_SIZE}`)

const done = []
let halted = null

for (const ids of batches) {
  const result = await buildBatch(ids)
  done.push(result)

  if (!result.passed) {
    halted = `${ids.join(', ')} did not pass review after ${result.attempts} attempt(s)`
    log(`HALT: ${halted}`)
    break
  }

  const landed = await landBatch(result)
  result.landed = landed

  const committed = landed && landed.committed ? landed.committed : []
  if (committed.length !== ids.length) {
    halted = `${ids.join(', ')} built but only committed ${committed.join(', ') || 'nothing'}: ${landed ? landed.problem : 'the land agent returned nothing'}`
    log(`HALT: ${halted}`)
    break
  }

  log(`landed ${ids.join(', ')}`)
}

return {
  batches: done.map((b) => ({
    ids: b.ids,
    passed: b.passed,
    attempts: b.attempts,
    ambiguous: b.dev ? b.dev.rules.filter((r) => r.ambiguous).map((r) => r.id) : [],
    decided: b.dev ? b.dev.decided : [],
    unmet: b.review ? b.review.unmet : [],
    notes: b.review ? b.review.notes : [],
    committed: b.landed ? b.landed.committed : [],
  })),
  halted,
}
