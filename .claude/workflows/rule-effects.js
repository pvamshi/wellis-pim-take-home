export const meta = {
  name: 'rule-effects',
  description: 'Measure what a changed rule would do to the data, judge it, and challenge the verdict, before anyone presses Apply rules',
  whenToUse:
    'Runs by itself at the end of the revise workflow. By hand, run it after a rule gets a new version: pass rule ids as args, e.g. args: ["P47"]; with none, it takes the rules changed in the working tree, or else by the last commit that touched the catalogue.',
  phases: [
    { title: 'Measure', detail: 'find the changed rules, run their tests, run old and new versions side by side', model: 'sonnet' },
    { title: 'Judge', detail: 'read the examples against what each rule is meant to do', model: 'sonnet' },
    { title: 'Challenge', detail: 'an independent attempt to prove each verdict wrong', model: 'sonnet' },
  ],
}

const CATALOGUE_DIR = 'apps/api/src/rules/catalogue'
const REGISTRY = 'apps/api/src/rules/rule-catalogue.ts'
const CATALOGUE_NOTES = 'notes/rule-catalogue.md'

// Rules one judge holds at once. The judge and the challenger read every example
// of every rule they are handed, so a batch is bounded by what one context can
// read closely. Batches only read, so they run side by side.
const BATCH_SIZE = 4

// Examples the effects answer keeps per group (RuleEffectsService). Verdicts
// rest on these; the counts are always complete.
const EXAMPLE_LIMIT = 10

const COUNTS = [
  'newlyFound',
  'noLongerFound',
  'proposalChanged',
  'unchanged',
  'wouldRecord',
  'alreadyRecorded',
  'declinedEarlier',
  'onImportedPatients',
  'oldPendingLeft',
  'rowsBecomingPending',
]

// The counts that mean the change touches something. unchanged, alreadyRecorded
// and onImportedPatients alone leave the data exactly as it is.
const MOVING = [
  'newlyFound',
  'noLongerFound',
  'proposalChanged',
  'wouldRecord',
  'declinedEarlier',
  'oldPendingLeft',
  'rowsBecomingPending',
]

const wanted =
  typeof args === 'string' && args ? [args] : Array.isArray(args) && args.length ? args.map(String) : null

const GROUND_RULES = `
Ground rules for every agent in this workflow:

- You change nothing. Write no file inside this repository, write nothing to the
  database, commit nothing, and never approve, decline or press Apply rules. The
  only thing you may write is a file in a temporary directory outside the
  repository.
- While the API answers, never run 'just build', 'just rules-sync', 'just revise'
  or any 'nest build': they rebuild it underneath 'just dev' and stop it.
- A rule is code keyed by (ruleId, version). A change is a new version appended;
  an existing version is never edited or removed (1.1.1, 1.1.8).
- A human's decline on a row is permanent, at every version (1.2.9). An accepted
  change is final (1.2.11). A finding on an imported patient records nothing.
`

const FIELDS = `
What each rule's effects say, the new version compared with the old, address by
address (table, legacy id, column):
- newlyFound / noLongerFound / proposalChanged / unchanged: found by the new
  version only, by the old only, by both with different proposals, by both alike.
- wouldRecord: new pending findings Apply rules would record.
- rowsBecomingPending: rows Import clean today that those findings would hold
  back from import.
- declinedEarlier: findings a human declined before, which are never raised again.
- onImportedPatients: findings on patients already imported, which record nothing.
- alreadyRecorded: new-version findings already recorded.
- oldPendingLeft: pending findings of older versions. They keep their rows
  pending until someone decides them; the new version does not replace them.
- linksBefore / linksAfter: duplicate links each version finds.
Every group has a complete count and at most ${EXAMPLE_LIMIT} examples. In an
example, current is what the column holds, before is the old version's proposal
and after is the new version's.
`

// What the judge and the challenger may read. The same list for both, so the
// challenger checks the judge on the judge's own evidence and nothing wider.
function sources(effectsFile) {
  return `
Sources, for each rule. Read these and no other rows of the data: you judge the
examples, not the dataset.
- The saved measurement:
    jq '.[] | select(.ruleId == "<id>")' ${effectsFile}
- The rule's code, every version: the files
    rg -l "ruleId: '<id>'" ${CATALOGUE_DIR}
  lists. Each version's doc comment says what it catches, what it proposes and why.
- What the rule is meant to catch, in the catalogue notes:
    rg -n "\\b<id>\\b" ${CATALOGUE_NOTES}
  Those lines only, never the whole file.
- Why an old version was sent back, when it was. The database is the file
  DATABASE_URL in .env names, relative to apps/api:
    sqlite3 -readonly <file> "select version, status, reason from rule_version where rule_id = '<id>'"
    sqlite3 -readonly <file> "select legacy_id, [column], previous_value, next_value, reason from legacy_patient_rule where rule_id = '<id>' and status = 'declined' and reason is not null"
  and the same for legacy_intake_rule and legacy_consent_rule.
`
}

const MEASURED_RULE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ruleId: { type: 'string' },
    newestInCode: { type: ['number', 'null'], description: 'null when no catalogue file names the rule' },
    activeInDatabase: { type: ['number', 'null'], description: 'null when none is active, or the database could not be read' },
    from: { type: ['number', 'null'] },
    to: { type: 'number', description: '0 when not measured' },
    ...Object.fromEntries(COUNTS.map((key) => [key, { type: 'number' }])),
    problem: {
      type: 'string',
      description: 'Why this rule has no trustworthy numbers (not measured, or measured against stale code); empty otherwise',
    },
  },
  required: ['ruleId', 'newestInCode', 'activeInDatabase', 'from', 'to', ...COUNTS, 'problem'],
}

const MEASURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', enum: ['api', 'command', 'none'] },
    effectsFile: { type: 'string', description: 'Absolute path of the saved JSON array; empty when nothing was saved' },
    testsPassed: { type: 'boolean' },
    testsRun: { type: 'array', items: { type: 'string' }, description: 'The test command run, its exit status, and any rule with no spec' },
    rules: { type: 'array', items: MEASURED_RULE },
    problems: { type: 'array', items: { type: 'string' }, description: 'Anything wrong that is not one rule’s own problem' },
  },
  required: ['source', 'effectsFile', 'testsPassed', 'testsRun', 'rules', 'problems'],
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ruleId: { type: 'string' },
          verdict: { type: 'string', enum: ['safe to apply', 'look first', 'wrong'] },
          summary: { type: 'string', description: 'What the change fixes or stops doing, and how many rows move, in product terms' },
          examples: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                group: { type: 'string' },
                legacyId: { type: 'string' },
                column: { type: 'string' },
                current: { type: ['string', 'null'] },
                before: { type: ['string', 'null'] },
                after: { type: ['string', 'null'] },
                assessment: { type: 'string' },
              },
              required: ['group', 'legacyId', 'column', 'current', 'before', 'after', 'assessment'],
            },
          },
          risks: { type: 'array', items: { type: 'string' } },
          judgedOn: { type: 'string', description: 'How many examples were read, of how many rows, per group that has any' },
        },
        required: ['ruleId', 'verdict', 'summary', 'examples', 'risks', 'judgedOn'],
      },
    },
  },
  required: ['rules'],
}

const CHALLENGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ruleId: { type: 'string' },
          upheld: { type: 'boolean' },
          countsMatch: { type: 'boolean' },
          counterpoints: { type: 'array', items: { type: 'string' }, description: 'Each names the example or claim and what the file says instead' },
        },
        required: ['ruleId', 'upheld', 'countsMatch', 'counterpoints'],
      },
    },
  },
  required: ['rules'],
}

function measurePrompt() {
  const which = wanted
    ? `These, and no others: ${wanted.join(', ')}.`
    : `The rules changed most recently. First the working tree:
     git status --porcelain -- ${CATALOGUE_DIR}
   and only if that lists nothing, the last commit that touched the catalogue:
     git log -1 --format=%H -- ${CATALOGUE_DIR}
     git show --name-status --format= <that sha> -- ${CATALOGUE_DIR}
   A file's rule is the ruleId written inside it, not its file name. A file
   modified or deleted rather than added is an existing version being edited,
   which never happens (1.1.1): name it in problems, and measure the rule anyway.`

  return `${GROUND_RULES}

You are the MEASURE agent. You find the changed rules, run their tests, and save
what each change would do. You judge nothing.

1. Which rules. ${which}
   If there are none, return no rules and no problems. Nothing changed is an
   answer, not a failure.

2. For each rule, from the repository root:
   - The newest version in code: the highest version: in the files
       rg -l "ruleId: '<id>'" ${CATALOGUE_DIR}
     lists. A version not imported and listed in ${REGISTRY} does not run; say
     so in problems.
   - The active version in the database. DATABASE_URL in .env names the file,
     relative to apps/api:
       sqlite3 -readonly <file> "select version from rule_version where rule_id = '<id>' and status = 'active'"
     null when none is active, or when DATABASE_URL is not a file: URL.

3. The rules' tests, in one run from the repository root:
     npm run test -w apps/api -- <one filter per rule>
   The filter for a rule is rule- and its id in lower case, e.g. rule-p47, which
   matches every spec of that rule (rule-p47-v2 too). A rule with no spec is
   named in testsRun as having none. Fix nothing. Failing tests do not stop the
   measurement: report testsPassed false and carry on.

4. The effects. Make a directory outside this repository with mktemp -d. Read
   PORT from .env (4010 if absent), and ask whether the API answers:
     xh --ignore-stdin -b GET :<PORT>/health
   - It answers: source "api". The running API has the new code when it runs
     under 'just dev', which rebuilds on every change. For each rule:
       xh --ignore-stdin -b GET :<PORT>/rules/<id>/effects | jq --arg id <id> '{ruleId: $id} + .' > <dir>/<id>.json
     then gather them:
       jq -s . <dir>/*.json > <dir>/effects.json
     A rule whose "to" is lower than its newest version in code was measured
     against code the API has not loaded (its rebuild failed, or it is not
     watching). That is the rule's problem. Build nothing to fix it.
   - Nothing answers: source "command". Nothing is running, so a rebuild harms
     nothing:
       just rule-effects <id> <id> … > <dir>/effects.json
     It builds the API and prints the same answers as one JSON array.
   - Neither works: source "none", effectsFile empty, every rule not measured.
   Check the file parses: jq length <dir>/effects.json

5. The counts, exactly as the file has them. Never retype a number from memory:
     jq -c '.[] | {ruleId, from, to, problem, message, newlyFound: .newlyFound.count, noLongerFound: .noLongerFound.count, proposalChanged: .proposalChanged.count, unchanged, wouldRecord: .wouldRecord.count, alreadyRecorded, declinedEarlier: .declinedEarlier.count, onImportedPatients, oldPendingLeft: .oldPendingLeft.count, rowsBecomingPending}' <dir>/effects.json
   An entry carrying problem (from the command) or message (an error from the
   API) was not measured: that text is its problem, from null, to 0, every
   count 0.

Return one entry per rule from step 1, and effectsFile as the absolute path of
effects.json.

Return the structured result.`
}

function countsLine(rule) {
  return `${rule.ruleId}, version ${rule.from === null ? '(none, a new rule)' : rule.from} → ${rule.to}: ${COUNTS.map((key) => `${key} ${rule[key]}`).join(', ')}`
}

function judgePrompt(batch, effectsFile) {
  return `${GROUND_RULES}

You are the JUDGE agent. Each rule below has a new version. Decide, from the
examples the measurement saved, whether the change does what the rule is meant
to do.

The rules, with the measurement's counts:
${batch.map(countsLine).join('\n')}

The measurement: ${effectsFile}
${FIELDS}
${sources(effectsFile)}
For each rule, go group by group:
- newlyFound: is each new proposal right for the value the column holds?
- noLongerFound: was the old version wrong there, which is the change working,
  or was it a right fix the new version now misses?
- proposalChanged: which proposal is right, the old or the new?
- declinedEarlier: if the new version answers the reason those rows were
  declined for, they still never get the fix, because a decline is permanent.
  Say so.
- oldPendingLeft: say whether the new version supersedes them, since they stay
  pending until someone decides them.
- rowsBecomingPending: rows importable today that would not be after Apply rules.
A rule whose from is null is new: everything it finds is newly found, so judge
its proposals alone.

verdict:
- "safe to apply": every example you read is right, and no importable row is
  held back without reason.
- "look first": something needs a human's eye. Name it in risks.
- "wrong": an example shows the new version proposing a wrong value, or dropping
  a right fix. Quote it in examples.

summary: plain product terms, for whoever presses Apply rules. What the change
fixes or stops doing, and how many rows move. No file names, no code.
examples: up to three that carry the verdict, each with its group and your
assessment.
judgedOn: how many examples you read, of how many rows, per group that has any.

Return one entry per rule above, and no others.

Return the structured result.`
}

function challengePrompt(batch, effectsFile, judged) {
  return `${GROUND_RULES}

You are the CHALLENGE agent. You did not judge these rules. Another agent did,
and your job is to prove its verdicts wrong. A claim you cannot check does not
stand.

The rules, with the measurement's counts:
${batch.map(countsLine).join('\n')}

The measurement: ${effectsFile}
${FIELDS}
${sources(effectsFile)}
The judge's verdicts:
${JSON.stringify(judged.rules, null, 2)}

For each rule:
1. Every number in the judge's summary and judgedOn must match the saved
   measurement. Any that does not: countsMatch false.
2. "safe to apply": find what it passed over, checking every example in the
   file, not only the ones the judge quoted. A newlyFound or proposalChanged
   proposal that is wrong for the value, or a noLongerFound fix that was right,
   is enough: upheld false, quoted in counterpoints.
3. "look first" or "wrong": check each risk and each quoted example against the
   file and the rule's code. A risk the examples contradict, or a quoted value
   that is not in the file: upheld false, with why.
Otherwise upheld true, with no counterpoints.

Return one entry per rule the judge returned.

Return the structured result.`
}

function countsOf(rule) {
  return Object.fromEntries(COUNTS.map((key) => [key, rule[key]]))
}

// What stands between these effects and the data. Plain code, from the
// measurement's own numbers, so no agent can soften it.
function nextStepsOf(rule) {
  const steps = []

  if (rule.activeInDatabase !== rule.to) {
    const active = rule.activeInDatabase === null ? 'none is, or it could not be read' : `version ${rule.activeInDatabase} is`
    steps.push(`Version ${rule.to} is not the active version in the database (${active}). Apply rules runs only the active version, so none of this lands until it is.`)
  }

  if (rule.wouldRecord > 0) {
    const held = rule.rowsBecomingPending ? `, holding back ${rule.rowsBecomingPending} row(s) that are Import clean today` : ''
    steps.push(`Apply rules would record ${rule.wouldRecord} new finding(s)${held}.`)
  }

  if (rule.oldPendingLeft > 0) {
    steps.push(`${rule.oldPendingLeft} pending finding(s) from older versions stay until someone decides them.`)
  }

  return steps
}

phase('Measure')

const measured = await agent(measurePrompt(), {
  label: 'measure',
  phase: 'Measure',
  schema: MEASURE_SCHEMA,
  model: 'sonnet',
})

if (!measured) {
  return { rules: [], problems: ['the measure agent returned nothing'] }
}

for (const problem of measured.problems) log(`measure: ${problem}`)
if (!measured.testsPassed) log(`the rules' tests failed: ${measured.testsRun.join('; ')}`)

const report = {
  source: measured.source,
  effectsFile: measured.effectsFile,
  testsPassed: measured.testsPassed,
  testsRun: measured.testsRun,
  problems: measured.problems,
}

if (!measured.rules.length) {
  log('No changed rule was found, so there is nothing to show.')
  return { ...report, rules: [] }
}

const unmeasured = measured.rules.filter((rule) => rule.problem)
const still = measured.rules.filter((rule) => !rule.problem && !MOVING.some((key) => rule[key] > 0))
const moving = measured.rules.filter((rule) => !rule.problem && MOVING.some((key) => rule[key] > 0))

for (const rule of unmeasured) log(`${rule.ruleId}: not measured (${rule.problem})`)
for (const rule of still) log(`${rule.ruleId}: no effect on the data`)

const batches = []
for (let start = 0; start < moving.length; start += BATCH_SIZE) {
  batches.push(moving.slice(start, start + BATCH_SIZE))
}

if (moving.length) {
  log(`${moving.length} rule(s) to judge in ${batches.length} batch(es). Each group carries at most ${EXAMPLE_LIMIT} examples: verdicts rest on those, while every count is complete.`)
}

const ids = (batch) => batch.map((rule) => rule.ruleId).join(',')

const rounds = await pipeline(
  batches,
  (batch) =>
    agent(judgePrompt(batch, measured.effectsFile), {
      label: `judge:${ids(batch)}`,
      phase: 'Judge',
      schema: JUDGE_SCHEMA,
      model: 'sonnet',
    }),
  (judged, batch) =>
    judged
      ? agent(challengePrompt(batch, measured.effectsFile, judged), {
          label: `challenge:${ids(batch)}`,
          phase: 'Challenge',
          schema: CHALLENGE_SCHEMA,
          model: 'sonnet',
        }).then((challenged) => ({ judged, challenged }))
      : { judged: null, challenged: null },
)

function entryFor(result, ruleId) {
  return result ? result.rules.find((entry) => entry.ruleId === ruleId) : undefined
}

// A verdict survives only what checked it. The challenger disagreeing, or
// anything that left the verdict unchecked, turns it into "look first".
const judgedRules = moving.map((rule) => {
  const round = rounds[batches.findIndex((batch) => batch.includes(rule))]
  const judged = round ? entryFor(round.judged, rule.ruleId) : undefined
  const challenged = round ? entryFor(round.challenged, rule.ruleId) : undefined
  const doubts = []

  if (!judged) doubts.push('the judge returned no verdict for this rule')
  if (judged && !challenged) doubts.push('the challenge returned nothing, so the verdict is unchecked')
  if (challenged && !challenged.upheld) doubts.push(...challenged.counterpoints)
  if (challenged && !challenged.countsMatch) {
    doubts.push("the judge's numbers do not match the measurement; the counts here are the measurement's")
  }
  if (!measured.testsPassed) doubts.push("the rules' tests failed")

  let verdict = judged ? judged.verdict : 'look first'
  if (challenged && !challenged.upheld) verdict = 'look first'
  if (verdict === 'safe to apply' && doubts.length) verdict = 'look first'

  return {
    ruleId: rule.ruleId,
    from: rule.from,
    to: rule.to,
    verdict,
    summary: judged ? judged.summary : '',
    examples: judged ? judged.examples : [],
    risks: judged ? judged.risks : [],
    judgedOn: judged ? judged.judgedOn : '',
    doubts,
    counts: countsOf(rule),
    nextSteps: nextStepsOf(rule),
  }
})

for (const rule of judgedRules) log(`${rule.ruleId}: ${rule.verdict}`)

return {
  ...report,
  rules: [
    ...judgedRules,
    ...still.map((rule) => ({
      ruleId: rule.ruleId,
      from: rule.from,
      to: rule.to,
      verdict: 'no effect',
      counts: countsOf(rule),
      nextSteps: nextStepsOf(rule),
    })),
    ...unmeasured.map((rule) => ({ ruleId: rule.ruleId, verdict: 'not measured', problem: rule.problem })),
  ],
}
