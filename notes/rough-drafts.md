# Rough drafts

Raised, not settled. We know it matters; we do not yet know its shape.
Every one of these gets picked up eventually.

Nothing moves to `final-requirements.md` until Vamshi approves it.

Node 4 is not here. Decisions that are taken get lifted out into their own note —
the tech stack lives in `tech-stack.md`, and that is what agents read. We follow
this pattern from here on: rough drafts are for thinking, decision notes are for
building against.

## 0. Delivery
- Iterative. Feature by feature, in order: legacy migration (1), new patient
  intake (2), review of new patients (3).
- As features land we will run data migrations and code upgrades.
- Commit frequently.

## 1. Legacy migration
- Legacy data has many problems. Migration is the process of resolving every
  problem on a row until that row is fit to enter the main table.

### 1.0 Import script
- A script that loads the legacy export into the legacy tables.
- Running it twice does not duplicate anything.
- Covers all three sources: `patients.csv`, `intakes.csv`, `consents.jsonl`.

#### 1.0.1 The check is against the database, nothing else
- Identity is `legacy_xxx_id` — `legacy_id` for patients, `intake_id` for
  intakes, and the same idea for consents.
- Walk the ids in the file being imported. For each one, ask only: is this id
  already in the database?
- Already there: decline that row.
- Not there: import it.
- Two rows in the file sharing an id is fine. Both are new to the database, so
  both go in. We never decline a row because of another row in the same import.
- There is no notion of file identity — no filename tracking, no content hash.
  "The same file" only ever means the one currently being imported.

#### 1.0.2 Same id, different data
- Ignore it. The row is skipped and nothing is recorded about it.
- No update, no merge, no conflict queue, no record of what was skipped. The id
  being present is the whole test; we do not compare the values at all.
- Reporting on skipped rows is deliberately out of scope. See `deferred.md` D4.

#### 1.0.3 Consents are the same
- Same rule, same check.
- Two events in one file that look identical both go in. Duplicates inside a file
  are real data — rules deal with them later (1.6.3), not the importer.

#### 1.0.4 What this makes the import
- Re-running the identical file imports nothing, because every id is now in the
  database. That is the idempotency, and it costs one lookup.
- Re-import as a feature — merging, conflicts, reporting what was skipped — is
  cut. See `deferred.md` D4.

### 1.1 Rules engine
- Rules are generated from the initial data structure plus feedback Vamshi gives.
- The engine is living: every round of feedback updates the rules.
- AI never applies a rule. AI only creates rules and collects feedback on them.

#### 1.1.1 Rule catalogue
- The exhaustive list of rules. Assigned to me.
- Not written yet — it needs a pass over `patients.csv`, `intakes.csv` and
  `consents.jsonl` first, not over `EXPORT-NOTES.md` alone.

#### 1.1.2 Rule storage
- Rules live in the database: id, name, description.
- Versions are a second table, one-to-many against the rule.

#### 1.1.3 Rule code
- `(rule id, version)` is the key. Each key has matching code in the codebase.
- A version change means a new key and new code written against it. The old code
  stays.
- This is what lets us say which rule, at which version, made a given change.
- So a rule change is a deploy, not a runtime edit. What that buys is rules that
  are reviewable, testable and in git.

#### 1.1.4 Rules never write anything
- A rule may read data and run DB queries. It writes nothing at all — not the
  data tables, not the rule tables. Hard rule.
- It returns its findings as JSON and stops there.

#### 1.1.11 Only the API applies a change
- Accepting a change is an API call, not something the rule does.
- The API updates the rule row and the data row together, in one transaction.
- That transaction is what gives us the log of why the data changed: the row's
  new value and the rule row that explains it land or fail as one.

#### 1.1.12 A rule is one function, and the API does the rest
- The rule checks the data and returns the updates as JSON. That is all it does.
- A shared API takes that JSON and writes the rows into the rule table. It is
  also what skips a row that already has a declined entry (1.6.2.1).
- Why the split: the declined-row check is a correctness rule, and we are
  deliberately mass-producing rules (1.1.8). Leaving that check to each generated
  rule means every one of them can get it wrong. In one API it is written once.
- Applying an accepted change is that same layer's job (1.1.11), never the
  rule's.

#### 1.1.14 Rules are atomic
- One rule, one fix. We never club several fixes into a single rule.
- So a rule is approved or declined as one thing, and the reason a value changed
  is always a single rule, never a bundle.
- This is what makes 1.1.8 work: mass-producing rules is only cheap if each one
  is small enough to judge at a glance.

#### 1.1.13 A rule changes the column it tested
- The column a rule finds the problem in is the column it changes. It does not
  test one column and rewrite another.
- That makes rules self-terminating: fix the bad date and the date is no longer
  bad, so the rule stops matching on the next run. Approved rows need no guard.
- The one case left is a rule whose own fix does not satisfy its own condition.
  It re-proposes forever, and it is visibly broken, so it gets crossed out.

#### 1.1.5 Rule scope
- A rule is not scoped to a single value. It can target one value in a row,
  several rows, or data spanning two tables.
- That is why rules get database access instead of being handed a single value.

#### 1.1.6 Rule lifecycle
- A rule is never deleted. It is made inactive.
- Exactly one version of a rule is active at any time.

#### 1.1.7 Where rules come from
- Three sources.
- The data type of the target data, read out of `legacy_export/EXPORT-NOTES.md`,
  along with the hints the old team left in there.
- My own guess: a field of type date is likely to have these kinds of problems,
  so write the rule and see what it catches.
- Vamshi's feedback: he names a problem, I derive rules from it.

#### 1.1.8 Why we over-produce rules
- Writing the code is cheap. So write as many rules as possible and catch as
  many problems as possible.
- Whether a rule is *correct* is not decided by us — it is decided by Vamshi's
  feedback in the UI.
- That is affordable because one rule covers many rows. A single decision clears
  all of them at once.

#### 1.1.10 Everything is a field
- A rule's finding is always about a field: table, row, field, old value, new
  value. There is no second shape.
- A relationship is not an exception — it is a value in the database too. A
  broken link between two tables is a field holding the wrong value, and it
  renders as a difference like any other.
- So the whole UI can be built on one uniform before-and-after, and rules that
  span tables do not need a separate home.

#### 1.1.9 Rule creation is not gated
- There are not two layers of approval. AI is free to create as many rules as it
  wants, and a new rule runs against the data immediately.
- The only gate is the UI: Vamshi sees the rules that matched something, and
  approves, rejects or modifies them there.
- A rule that matches nothing is invisible and costs nothing, so there is no
  reason to gate creation.

### 1.2 Apply and review
- Rules produce proposals for data updates. The proposals are what the UI shows.
- The user accepts or declines each proposal.
- On acceptance the raw data is modified.
- Only rules that actually match something in the data are shown. A rule with no
  matches does not appear.

#### 1.2.1 Ambiguous findings
- Ambiguity is a property of the rule, not of the individual row. A rule either
  fixes what it finds or it does not, and `rule.ambiguous` says which.
- So there is no per-row explanation column. The rule's own description is the
  explanation, and its rows carry `previousValue` with no `nextValue`.
- These are shown explicitly as ambiguous, not as proposals.
- The user responds with either how to fix it, or by ignoring the rule.
- That feedback either makes the rule inactive, or produces a new version that
  fixes the case the way the user described.

#### 1.2.2 Re-evaluation
- Rules read the modified data, not a frozen snapshot.
- Re-evaluation is manual. An "Apply rules" button in the UI runs every rule over
  the entire dataset again and refreshes what is shown.
- Nothing re-evaluates automatically on approve. The user decides when.

#### 1.2.0 The UI is decided after the rules exist
- Order of work: scaffolding, then the backend infrastructure for rules, then the
  rules themselves, then the UI. The UI can be empty until then.
- Nobody reads the whole dataset looking for rules before that infrastructure
  exists.
- We write the rule catalogue (1.1.1) once there is somewhere to put it, then
  decide what the UI looks like from what the rules actually produce.
- Everything in 1.2.4 to 1.2.8 below is how it looks in Vamshi's head today, not
  a settled design. It gets revisited against the real catalogue.

#### 1.2.4 The rules list
- A list of rules, sorted by how many rows each one caught, most first.
- Only rules that caught something appear.
- Expanding a rule shows every row it caught, with the previous value and the new
  value side by side.

#### 1.2.5 Approve
- One button on the rule, not per row.
- Approving applies the change to every matching row at once.

#### 1.2.6 Decline
- Declining opens a popup asking for a reason.
- The reason is optional. The user may decline with no reason at all.
- If a reason is given, we use it to modify the rule to match the feedback.

#### 1.2.7 Exclude a row
- Every row carries a cross button that excludes it.
- Unticked checkbox: that row is declined. It and that rule never go together
  again, for any version (1.6.2.1). The rule itself is untouched and its other
  rows stay approvable.
- Ticked checkbox — "the rule is wrong, this row is the evidence": the row is NOT
  declined. Instead the whole rule is disabled, `needsReview` goes true, and the
  reason is recorded against the rule, not the row.
- That is what makes the revision work. The row stays eligible, so when the new
  version arrives it proposes the correct value on exactly the row that exposed
  the bug.
- Consequence: ticking the checkbox parks the entire rule until the revision
  workflow produces a new version. Its other pending rows wait. We accept that —
  a rule known to be wrong should not keep being approved (1.2.8).

#### 1.2.8 We assume a sane operator
- The end user is one of us, not a customer.
- So we assume they will not approve a rule while they are waiting on a
  modification they just asked for. We do not build a guard against it.
- This is a deliberate simplification, recorded because it is an assumption and
  not a fact.

#### 1.2.3 Acceptance is final
- An accepted proposal is settled. We do not revisit it and there is no undo.
- See `deferred.md` D2 for what this costs and why we took it.

### 1.3 Modification log
- Every modification is logged: which rule was applied, and the new structure.

### 1.4 Promotion
- Once all problems on a row are resolved, that row becomes eligible to be added
  to the main table.
- The main table itself is next phase. Not designed yet, and deliberately so —
  including whether new patient intake (2) writes into the same tables.

### 1.5 Feedback loop
- Two kinds of feedback, both given from the UI:
  - Decline this rule, with a reason.
  - Exclude this row from this rule, with a reason.
- A reason is optional. The user may decline or exclude without giving one — we
  simply learn nothing from it when they do.
- A workflow reads all the feedback and updates the rule accordingly.

#### 1.5.1 Exclude this row, or change the rule
- The comment carries a checkbox: modify the rule with this change.
- Unchecked: this row alone is declined, permanently and across all versions.
  The rule is untouched and its other rows can still be approved.
- Checked: the row is left alone and the whole rule is disabled for revision.
  See 1.2.7.
- Checked: the change applies to every value this rule touches. The feedback
  workflow produces a new version of the rule.
- So the checkbox is what separates a one-row carve-out from a rule revision,
  and the user states which one they mean rather than us inferring it.
- Inferring that intent from the free-text reason is the kind of guess that
  produces a rule which looks clean while quietly carrying carve-outs nobody sees.

## 1.6 Rules database structure
- Vamshi's structure. Replaces the six-table version I had proposed.

### 1.6.1 Rules: two tables
- `rule` holds identity. `rule_version` holds the versions.
- Active/inactive sits on the version, not the rule.

```ts
type Rule = {
  ruleId: string
  ruleName: string
  description: string
  ambiguous: boolean       // true = this rule finds a problem it cannot fix
}

type RuleVersion = {
  ruleId: string           // FK
  version: number          // (ruleId, version) is the key the code is written against
  status: 'active' | 'inactive'
  needsReview: boolean     // set when the user declines this version
  reason: string | null    // why they declined it
}
```

#### 1.6.1.1 How a version gets revised
- Declining a rule does three things to its version: status goes inactive,
  `needsReview` goes true, and the reason is written to `reason`.
- The AI workflow picks up every version with `needsReview = true`, revises the
  rule, writes a new version, makes the new version active, and clears
  `needsReview`.
- So `needsReview` is the queue the revision workflow reads. Nothing else drives
  it.
- Vamshi runs that workflow manually. No schedule, no trigger on write.

#### 1.6.1.2 A revision may split into two rules
- The workflow is not limited to writing a new version of the same rule.
- It may decide the feedback describes a case that deserves its own rule: write a
  new version of the old rule, narrowed, and create a new rule alongside it for
  the case that was missed.
- The AI decides whether the old rule becomes active again.
- Parking the whole rule on a single row's feedback is therefore the right
  behaviour, not a cost: one affected row usually means others are affected by
  the same problem, and re-running the corrected rule catches all of them
  together.

### 1.6.2 Two tables per legacy table
- Three legacy sources — patient, intake, consent — and each gets two tables.
- The data table carries a new id, the legacy id, every column from the export,
  and `rawData`: exactly what came out of the source, never changed. The other
  columns are what rules modify.
- The rule table is the important one. One row per proposed change to one column
  of one legacy row.
- `status` is `pending`, `approved` or `declined`.

```ts
type LegacyPatient = {
  id: string
  legacyPatientId: string
  // ...every column from the export
  rawData: string          // the original, untouched, forever
}

type LegacyPatientRule = {
  legacyPatientId: string
  ruleId: string
  version: number
  column: string
  previousValue: string | null
  nextValue: string | null   // null on an ambiguous rule — there is no fix
  status: 'pending' | 'approved' | 'declined'
  reason: string | null      // why this row was declined, if the user gave one
}
```

- Same shape for `legacy_intake` / `legacy_intake_rule` and `legacy_consent` /
  `legacy_consent_rule`.

#### 1.6.2.1 A declined row is declined forever
- Once a row is declined for a rule, that rule never matches that row again — for
  any version, ever.
- So the decline is looked up by `(legacyId, ruleId, column)`. The version is
  recorded on the row for history, but it is not part of that check.

### 1.6.3 Duplicates get their own table
- Duplicate tracking is separate, not a column on every row.
- Why: we do not want to pollute every row with information that concerns a few.

### 1.6.4 What the rules screen queries
- Join `rule`, `rule_version` and the per-table rule table.
- Show only rules whose version is active and which have at least one row in
  `pending`. A rule with nothing pending does not appear at all.
- Approve and decline act on that pending set.
- If the rule also has rows in `approved`, they show as a second section. So one
  rule can render two sections: what is waiting, and what was already applied.


## 2. New patient intake
- Built after legacy migration.

## 3. Review
- Review for new patients. Built last.

## 5. Agent workflows
- We use workflows heavily. Agents work in the background.
- Workflow scripts live in `.claude/workflows/`.

### 5.1 Three-agent pattern
- Every unit of work runs through three agents, and this is the pattern we
  follow throughout the project, not just for scaffolding.
- Agent 1 clarifies: are the requirements, the design, everything clear?
  It writes no code.
- Agent 2 implements exactly what agent 1 settled.
- Agent 3 reviews.
- A unit whose requirements are not clear is not built. Its gaps come back to
  Vamshi instead. Anything the clarify agent would have to invent counts as a
  gap, not an assumption.

### 5.2 Scaffold workflow
- First workflow. Turns `tech-stack.md` into a running skeleton.
- `.claude/workflows/scaffold.js`. Not run yet.
- Root runs through the three-agent pattern first; backend and frontend then run
  through it in parallel. A report is written to `notes/scaffold-report.md` and
  the open gaps are appended to `notes/unresolved-questions.md`.

### 5.3 Commits
- After every meaningful step, an agent commits and pushes automatically.
- A step is committed only once it passes review. Failing work stays uncommitted.
- Committing is serial and done by one dedicated agent at a time. Parallel agents
  running `git add` in the same repository fight over `index.lock`.
- The commit agent never force-pushes, rebases, resets or checks out. A rejected
  push is reported, not worked around.

### 5.4 What agents read
- `tech-stack.md` is the source of truth for technology decisions.
- `unresolved-questions.md` is what is still open. An agent that finds its answer
  there has found a gap, not an answer.
- Agents never write to `final-requirements.md`.
