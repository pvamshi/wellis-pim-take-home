# Final requirements

Settled. Nothing enters here without Vamshi's explicit approval. Numbers are
addresses, not order — they are never renumbered or reordered.

Open items live in `unresolved-questions.md`. Deliberate cuts live in
`deferred.md`. Neither is repeated here.

---

# Part A — Legacy migration

## 1.0 Import

The import script loads `legacy_export/` into the legacy tables. Identity is the
legacy id — `legacy_id` for patients, `intake_id` for intakes, and the same idea
for consents. The only test is whether that id is already in the database.

### 1.0.1 A new id is imported

```gherkin
Scenario: a patient id not yet in the database
  Given legacy_patient holds no row with legacy_id "recABC"
  When the import reads a patients.csv row with legacy_id "recABC"
  Then a legacy_patient row is created
  And rawData holds the source row exactly as it arrived
```

### 1.0.2 An id already in the database is ignored

```gherkin
Scenario: re-running the same file
  Given legacy_patient already holds a row with legacy_id "recABC"
  When the import reads a patients.csv row with legacy_id "recABC"
  Then no row is created
  And no row is updated
  And nothing is recorded about the skip

Scenario: the same id arriving with different values
  Given legacy_patient holds legacy_id "recABC" with email "a@x.nl"
  When the import reads a row with legacy_id "recABC" and email "b@x.nl"
  Then no row is created
  And the stored email is still "a@x.nl"
```

The values are never compared. The id being present is the whole test.

### 1.0.3 A repeated id inside one import is not a duplicate

```gherkin
Scenario: two rows in the file share an id
  Given legacy_patient holds no row with legacy_id "recABC"
  When the import reads two patients.csv rows both with legacy_id "recABC"
  Then two legacy_patient rows are created
```

Duplicates inside a file are real data. Rules deal with them, not the importer.

### 1.0.4 Consents behave identically

```gherkin
Scenario: two identical consent events in one file
  Given no matching consent rows exist
  When the import reads two consents.jsonl lines with identical content
  Then two consent rows are created
```

### 1.0.5 The import is idempotent

```gherkin
Scenario: running the import twice
  Given the import has completed once against legacy_export/
  When the import runs again against the same files
  Then no new rows are created in any legacy table
```

---

## 1.1 Rules engine

### 1.1.1 A rule is code, keyed by version

`(ruleId, version)` is the key. Each key has matching code in the codebase. A
version change means a new key and new code written against it; the old code
stays. A rule change is therefore a deploy, not a runtime edit — which is what
buys us rules that are reviewable, testable and in git.

### 1.1.2 A rule never writes

```gherkin
Scenario: a rule runs
  Given a rule is executing against the legacy data
  When it finds a problem
  Then it returns its findings as JSON
  And it has written nothing to any data table
  And it has written nothing to any rule table
```

A rule may read and run DB queries. It writes nothing at all.

### 1.1.3 A rule is one function; the API persists

The rule checks the data and returns updates as JSON. A shared API takes that
JSON and writes the rows into the rule table. The same layer applies accepted
changes (1.2.5). Persistence, the declined-row skip, and the apply transaction
all live in that one place — never in generated rule code.

### 1.1.4 A rule is atomic

One rule, one fix. Several fixes are never clubbed into a single rule. A rule is
approved or declined as one thing, and the reason a value changed is always a
single rule, never a bundle.

### 1.1.5 A rule changes the column it tested

```gherkin
Scenario: an approved fix stops matching
  Given rule R7 proposes a phone correction on patient P-1042
  And the change has been approved and applied
  When the rules are run again
  Then R7 does not match P-1042
```

The column a rule finds the problem in is the column it changes. That makes
rules self-terminating, so approved rows need no guard.

### 1.1.6 A rule's scope is wider than one value

A rule may target one value in a row, several rows, or data spanning two tables.
That is why rules get database access rather than being handed a single value.
Its finding is still field-shaped (1.1.7).

### 1.1.7 Everything is a field

A finding is always `(table, row, column, previousValue, nextValue)`. There is no
second shape. A relationship is a value in the database too — a broken link
between two tables is a field holding the wrong value, and it renders as a
difference like any other.

### 1.1.8 A rule is never deleted

It is made inactive. Exactly one version of a rule is active at any time.

### 1.1.9 Rules come from three sources

- The data type of the target column, read out of `EXPORT-NOTES.md` and the hints
  the old team left there.
- Informed guesses: a date column is likely to have these problems, so write the
  rule and see what it catches.
- Vamshi's feedback: he names a problem, rules are derived from it.

### 1.1.10 We over-produce rules on purpose

Writing the code is cheap, so write as many rules as possible and catch as many
problems as possible. Whether a rule is *correct* is decided by Vamshi in the UI,
not by us. That is affordable because one rule covers many rows — a single
decision clears all of them.

### 1.1.11 Rule creation is not gated

```gherkin
Scenario: a newly generated rule
  Given a new rule has just been written
  When the rules are run
  Then it produces findings immediately, with no prior approval
  And it appears in the UI only if it matched something
```

There are not two layers of approval. A rule that matches nothing is invisible
and costs nothing.

### 1.1.12 Some rules find problems they cannot fix

Ambiguity is a property of the rule, not of the row. `rule.ambiguous` says which.
An ambiguous rule's findings carry `previousValue` and no `nextValue`, and the
rule's own description is the explanation the human reads.

---

## 1.2 Apply and review

### 1.2.1 The rules screen shows only rules with work

```gherkin
Scenario: a rule with pending findings
  Given rule R7's active version has 340 rows in pending
  When the rules screen loads
  Then R7 appears with its 340 rows

Scenario: a rule with nothing pending
  Given rule R9's active version has no rows in pending
  When the rules screen loads
  Then R9 does not appear
```

The screen joins `rule`, `rule_version` and the per-table rule table, filtering
to active versions with at least one pending row. Rules sort by how many rows
each caught, most first.

### 1.2.2 A rule can show two sections

```gherkin
Scenario: a rule with both pending and approved rows
  Given rule R7 has 12 pending rows and 328 approved rows
  When R7 is expanded
  Then a pending section lists the 12 rows awaiting a decision
  And an approved section lists the 328 already applied
```

### 1.2.3 Expanding a rule shows before and after

Every row shows `previousValue` and `nextValue` side by side. An ambiguous rule's
rows show the previous value and the rule's description instead of a new value.

### 1.2.4 Approve acts on the whole rule

```gherkin
Scenario: approving a rule
  Given rule R7 has 340 pending rows
  When the user presses Approve on R7
  Then all 340 rows move to approved
  And each row's column is updated to its nextValue
```

One button on the rule, not per row.

### 1.2.5 Applying is one transaction

```gherkin
Scenario: a change is accepted
  When a pending row is approved
  Then the rule row's status and the data row's column are written together
  And if either write fails, neither is applied
```

That transaction is what gives the log its meaning: the new value and the rule
row explaining it land or fail as one.

### 1.2.6 Declining a rule asks for a reason

```gherkin
Scenario: declining with a reason
  When the user presses Decline on rule R7 and gives a reason
  Then R7's active version status becomes inactive
  And its needsReview becomes true
  And the reason is stored on that version

Scenario: declining without a reason
  When the user presses Decline on rule R7 and gives no reason
  Then R7's active version becomes inactive
  And needsReview becomes true with no reason recorded
```

The reason is optional. Without one we simply learn nothing from it.

### 1.2.7 Excluding a row, unticked, declines that row forever

```gherkin
Scenario: this row is wrong, the rule is fine
  Given rule R7 proposes a change on patient P-0455
  When the user crosses out P-0455 without ticking "modify the rule"
  Then that rule row's status becomes declined
  And the reason, if given, is stored on the rule row
  And rule R7 is untouched and its other rows stay approvable
  And no version of R7 ever proposes on P-0455 again
```

### 1.2.8 Excluding a row, ticked, revises the rule

```gherkin
Scenario: the rule is wrong, this row is the evidence
  Given rule R7 proposes a change on patient P-0817
  When the user crosses out P-0817 and ticks "modify the rule"
  Then P-0817's rule row is NOT declined
  And R7's active version becomes inactive with needsReview true
  And the reason is stored against the version, not the row
```

The row stays eligible so that the revised rule proposes the correct value on
exactly the row that exposed the bug. The consequence is deliberate: the whole
rule parks until a new version exists, because one affected row usually means
others are affected the same way.

### 1.2.9 A declined row is declined forever

```gherkin
Scenario: a later version meets a declined row
  Given patient P-0455 has a declined row for rule R7 on column phone
  And R7 version 2 is now active
  When the rules are run
  Then no pending row is written for P-0455, R7, phone
```

The decline is looked up by `(legacyId, ruleId, column)`. The version is recorded
for history but is not part of that check. The shared API enforces this, not the
rule.

### 1.2.10 Re-evaluation is manual

```gherkin
Scenario: pressing Apply rules
  When the user presses Apply rules
  Then every active rule version runs against the entire dataset
  And the screen refreshes from the results
```

Nothing re-evaluates automatically on approve. Rules read the modified data, not
a frozen snapshot.

### 1.2.11 Acceptance is final

An accepted change is settled. There is no undo and no replay of an earlier
version over data it already changed.

### 1.2.12 We assume a sane operator

The end user is one of us, not a customer. We assume they will not approve a rule
while waiting on a modification they just asked for, and we build no guard
against it.

---

## 1.3 Modification log

Every modification records which rule, at which version, changed which column
from what to what. The rule row itself is that log — written by the same
transaction that changed the data (1.2.5).

---

## 1.4 Promotion

Once all problems on a row are resolved, that row becomes eligible to be added to
the main table. The main table is next phase and is not designed yet, including
whether new patient intake (Part B) writes into the same tables.

---

## 1.5 Feedback loop

### 1.5.1 Feedback is what drives revision

```gherkin
Scenario: the revision workflow runs
  Given one or more rule versions have needsReview true
  When Vamshi runs the revision workflow manually
  Then each is revised into a new version
  And the new version becomes the active one
  And needsReview is cleared
```

`needsReview` is the queue. Nothing else drives it, and nothing triggers it
automatically — no schedule, no trigger on write.

### 1.5.2 A revision may split into two rules

The workflow is not limited to a new version of the same rule. It may write a
narrowed version of the old rule and create a new rule alongside it for the case
that was missed. Whether the old rule becomes active again is the workflow's
decision.

---

# Part B — New patient intake

Not specified yet. Built after legacy migration.

# Part C — Review console

Not specified yet. Built last.

---

# Database structure

## Rules — two tables

```ts
type Rule = {
  ruleId: string
  ruleName: string
  description: string      // for an ambiguous rule, this is what the human reads
  ambiguous: boolean       // true = finds a problem it cannot fix
}

type RuleVersion = {
  ruleId: string           // FK -> Rule
  version: number          // (ruleId, version) keys the code in the codebase
  status: 'active' | 'inactive'
  needsReview: boolean     // set when the user declines this version
  reason: string | null    // why they declined it
}
```

Exactly one version per rule is active at any time.

## Legacy data — two tables per source

Three sources, six tables. `legacy_patient` / `legacy_patient_rule`,
`legacy_intake` / `legacy_intake_rule`, `legacy_consent` / `legacy_consent_rule`.

```ts
type LegacyPatient = {
  id: string               // ours
  legacyPatientId: string  // theirs; not unique, see 1.0.3
  // ...every column from the export
  rawData: string          // the source row exactly as it arrived, never changed
}

type LegacyPatientRule = {
  legacyPatientId: string
  ruleId: string
  version: number
  column: string
  previousValue: string | null
  nextValue: string | null   // null on an ambiguous rule — there is no fix
  status: 'pending' | 'approved' | 'declined'
  reason: string | null      // why this row was declined, if a reason was given
}
```

The working columns are what rules change. `rawData` is the untouched original
and is never written after import.

## Duplicates

One table tracking duplicates across all three legacy tables, kept separate so
duplicate information does not pollute every row. Its shape is open — see
`unresolved-questions.md` 1.6.3.a.
