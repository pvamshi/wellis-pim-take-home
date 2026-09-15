export const meta = {
  name: 'rule-effects',
  description: 'Show what a changed rule would do to the data, before anyone presses Apply rules',
  whenToUse:
    'Run after a rule gets a new version (the revise workflow, or by hand). Pass rule ids as args, e.g. args: ["P47"]; with none, it takes the rules changed by the last commit that touched the catalogue.',
  phases: [{ title: 'Effects', detail: 'run the old and new versions side by side and explain the difference' }],
}

const wanted = Array.isArray(args) && args.length ? args.map(String) : null

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    apiReachable: { type: 'boolean' },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ruleId: { type: 'string' },
          from: { type: ['number', 'null'] },
          to: { type: 'number' },
          summary: { type: 'string', description: 'What the change does to the data, in plain product terms' },
          risks: { type: 'array', items: { type: 'string' } },
        },
        required: ['ruleId', 'from', 'to', 'summary', 'risks'],
      },
    },
    nextSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['apiReachable', 'rules', 'nextSteps'],
}

phase('Effects')

const report = await agent(
  `You report what a changed rule would do to the legacy data. You change nothing.

1. Which rules.
${
  wanted
    ? `   These: ${wanted.join(', ')}.`
    : `   The rules changed by the last commit that touched the catalogue:
     git log -1 --format=%H -- apps/api/src/rules/catalogue
     git show --name-only --format= <that sha> -- apps/api/src/rules/catalogue
   A file name is the rule id in lower case, with -v2, -v3 for later versions
   (p47-v2.ts is P47).`
}

2. The API. Read PORT from .env at the repository root (4010 if absent). The
   effects come from the running API, which already has the new rule code when
   \`just dev\` is running. If nothing answers on that port, stop and report
   apiReachable false. Never run 'just build', 'just rules-sync' or any
   'nest build': they rebuild the API underneath a running dev server and stop it.

3. For each rule:
     xh --ignore-stdin -b GET :<PORT>/rules/<ruleId>/effects
   It runs the rule's newest version in code and the one before it against the
   current data, and writes nothing. Pass from=/to= only if a rule's newest
   version is not the change being asked about.

   What the fields mean:
   - newlyFound / noLongerFound / proposalChanged / unchanged: the new version
     compared with the old, address by address.
   - wouldRecord: new pending findings Apply rules would record.
   - rowsBecomingPending: rows now Import clean that those findings would make
     pending, so they drop out of what can be imported.
   - declinedEarlier: findings a human declined before, which are never raised
     again.
   - onImportedPatients: findings on patients already imported, which record
     nothing.
   - alreadyRecorded: new-version findings already in the table.
   - oldPendingLeft: older versions' pending findings. They keep their rows
     pending until someone decides them; the new version does not replace them.
   - linksBefore / linksAfter: duplicate links each version finds.

4. For each rule write a summary in plain product terms: what the change fixes
   or stops doing, how many rows it touches, and quote up to three examples
   (current value, old proposal, new proposal). Then risks: anything a reviewer
   should look at before pressing Apply rules — for example a large
   rowsBecomingPending, noLongerFound rows that were right, a proposalChanged
   that looks wrong, or oldPendingLeft that will need deciding by hand.

5. nextSteps: whether the new version still has to be made active (compare with
   the rules screen or the rule_version table; 'just rules-sync' does it, and
   only while dev is stopped), then pressing Apply rules.

Do not write any file, commit, approve, decline, or press Apply rules.

Return the structured result.`,
  { label: 'effects', phase: 'Effects', schema: REPORT_SCHEMA, model: 'sonnet' },
)

return report
