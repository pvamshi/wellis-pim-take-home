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

### 1.0.1 The import is a bulk operation

Not row by row. Read the whole file, collect its ids, ask in one query which of
them are already in the database, and insert the remainder in one bulk insert.
That makes validating a run a matter of comparing counts rather than tracing
individual rows.

```gherkin
Scenario: importing a file
  Given patients.csv holds 2466 rows
  And legacy_patient already holds 400 of those legacy_ids
  When the import runs
  Then one query resolves which ids already exist
  And 2066 rows are inserted in a single bulk insert
  And each inserted row's rawData holds its source row exactly as it arrived

Scenario: reporting the run
  When the import finishes a file
  Then it reports rows read, rows inserted, and rows skipped
  And those three numbers reconcile: read = inserted + skipped
```

### 1.0.2 An id already in the database is ignored

```gherkin
Scenario: re-running the same file
  Given legacy_patient already holds a row with legacy_id "recABC"
  When the import runs over a file containing legacy_id "recABC"
  Then that id is excluded from the bulk insert
  And no row is updated
  And it counts towards skipped, with nothing else recorded about it

Scenario: the same id arriving with different values
  Given legacy_patient holds legacy_id "recABC" with email "a@x.nl"
  When the import runs over a file with legacy_id "recABC" and email "b@x.nl"
  Then that id is excluded from the bulk insert
  And the stored email is still "a@x.nl"
```

The values are never compared. The id being present is the whole test.

### 1.0.3 A repeated id inside one import is not a duplicate

```gherkin
Scenario: two rows in the file share an id
  Given legacy_patient holds no row with legacy_id "recABC"
  When the import runs over a file with two rows both having legacy_id "recABC"
  Then both rows are in the bulk insert
  And two legacy_patient rows are created
```

The existing-id check is against the database only. Ids are never de-duplicated
within the batch being inserted.

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

### 1.1.14 The runner calls rules blindly, and a rule answers in batches

The runner knows nothing about any rule. It calls every one of them and takes
whatever comes back.

A rule is called **once**, not once per row. It reads whole tables and returns
every row that needs updating in one response.

```gherkin
Scenario: a rule returns many changes at once
  Given 340 patient rows have a phone number in the wrong format
  When the runner calls the phone rule
  Then it is called exactly once
  And it returns 340 changes in a single response
  And each change carries table, row, column, previousValue, nextValue
```

The response is what the persistence layer turns into rule rows. The runner does
no per-row work of its own.

Ambiguity sits beside the updates, not inside each one — one flag for the whole
response, which is what 1.1.12 means by rule-wide. When it is true, every update
carries a `prev` and no `next`.

```ts
type RuleResponse = {
  ambiguity: boolean
  updates: {
    table: 'patient' | 'intake' | 'consent'
    legacyId: string
    column: string
    prev: string | null
    next: string | null    // null throughout when ambiguity is true
  }[]
}
```

### 1.1.4 A rule is atomic

One rule, one fix. Several fixes are never clubbed into a single rule. A rule is
approved or declined as one thing, and the reason a value changed is always a
single rule, never a bundle.

**Atomic means one fix, not one column.** A fix may need several columns of the
same row — converting a weight from pounds writes both `weight` and
`weight_unit`, and either one alone leaves the row wrong. Those changes are one
atom: shown together, approved together, declined together.

```gherkin
Scenario: a fix that spans two columns
  Given patient P-0310 holds weight 180 and weight_unit lbs
  When the weight-conversion rule runs
  Then it returns two updates for P-0310 — weight 81.6 and weight_unit kg
  And the screen shows them as one change with two columns
  And approving it writes both, in one transaction
  And declining it declines both

Scenario: a row action never applies half a fix
  Given a rule proposes two columns on patient P-0310
  When the user approves that row
  Then both columns are written
  And there is no way to approve one column and leave the other
```

### 1.1.5 A rule changes what it tested

```gherkin
Scenario: an approved fix stops matching
  Given rule R7 proposes a phone correction on patient P-1042
  And the change has been approved and applied
  When the rules are run again
  Then R7 does not match P-1042
```

A rule may read anything (1.1.6), and it changes the columns its own fix needs.
What makes rules self-terminating is not that the read and the write are the
same column — it is that after its fix the rule's condition is false. The
pounds conversion reads `weight_unit`, writes both columns, and then no longer
matches because the unit says `kg`.

A rule whose own fix does not falsify its own condition re-proposes forever. It
is visibly broken and gets crossed out.

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

### 1.1.13 Duplicates are a link, not a value

A duplicate says one thing: id X is a duplicate of id Y. That is all the
duplicates table holds. It does not fit — and does not need to fit — the
field-shaped finding of 1.1.7.

Anything that has to move from X to Y is an ordinary field change on Y, written
as a normal rule row with duplication as its reason. So merging needs no new
mechanism; it reuses 1.1.7 and 1.2.5 as they are.

```gherkin
Scenario: a duplicate is found
  Given patients P-100 and P-450 are the same person
  When the duplicate rule runs
  Then the duplicates table records P-450 as a duplicate of P-100
  And no column of either row is changed by that record alone

Scenario: a duplicate needs merging
  Given P-450 is recorded as a duplicate of P-100
  And P-450 holds a phone number that P-100 lacks
  When the merge is proposed
  Then it is an ordinary rule row against P-100's phone column
  And its reason names the duplication
```

Recording, confirming, dismissing, merging and retiring X: 1.7.

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

Where a rule proposes several columns on one row (1.1.4), they are shown as one
change listing every column, with one tick and one cross between them — not as
several entries a reviewer could act on separately.

### 1.2.4 Approve works at both levels

Approve and decline are symmetric: both act on a whole rule, and both act on a
single row. The rule-level button is the one that makes over-producing rules
cheap (1.1.10); the row-level one is for when most of a rule is right.

```gherkin
Scenario: approving a whole rule
  Given rule R7 has 340 pending rows
  When the user presses Approve on R7
  Then all 340 pending rows move to approved
  And each row's column is updated to its nextValue

Scenario: approving a single row
  Given rule R7 has 340 pending rows
  When the user approves the row for patient P-1042
  Then only that row moves to approved
  And only that patient's column is updated
  And R7's other 339 rows stay pending

Scenario: approving the rule after approving rows individually
  Given rule R7 has 338 pending rows and 2 approved rows
  When the user presses Approve on R7
  Then the 338 pending rows move to approved
  And the 2 already-approved rows are untouched
```

Every row carries both a tick and a cross. A row-level approve needs no reason;
a row-level decline may carry one (1.2.7).

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

### 1.2.13 An ambiguous finding is answered, not ticked

```gherkin
Scenario: the human supplies what the rule would not guess
  Given an ambiguous rule found a bad date of birth on patient P-0310
  When Vamshi types the correct date and presses Apply
  Then that value is written to the column
  And the finding records it and is approved
  And it is one transaction, as any approval is (1.2.5)

Scenario: there is nothing to tick
  Given a rule is ambiguous
  Then its rows carry no approve button at all
  And a value may only be supplied where the rule proposes none
```

An ambiguous rule proposes nothing (1.1.12), so a tick on its rows has nothing
to apply — the screen offers a box instead, and what is typed becomes that
finding's proposal and is applied down the same path as a rule's own. The box
starts at what the column holds, because the human is nearly always correcting a
value rather than inventing one. A blank box is an answer: it says the column
should hold nothing.

A value is never accepted for a finding that already proposes one. Overriding a
proposal would make the rule row a record of something the rule never said, and
the log (1.3) would stop being true. Disagreeing with a proposal is the cross
(1.2.7); changing one is a new version of the rule (1.1.8, 1.2.8).

The cross on such a row takes its reason inline rather than through the dialog.
The dialog exists to choose between declining a row and parking a version
(1.2.8), and that choice is already made by which button was pressed; on a row
nobody can propose a value for, why it was waved through is the only thing left
to record.

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

## 1.6 The rows screen

The rules screen (1.2) is the dataset seen through the rules. This is the same
work seen through the rows: every legacy row, what state it is in, and what is
still standing between it and being fit to import.

Both are needed and they answer different questions. "What is wrong across the
dataset" is a rule; "is this patient ready" is a row. Neither view can answer
the other's question without reading every line of it.

Not to be confused with 1.4. The table promoted *into* is still next phase and
still undesigned; this is a screen over the legacy tables we already have.

### 1.6.1 Every row, with its state

```gherkin
Scenario: the screen lists the dataset
  Given 2466 patients were imported
  When Vamshi opens the rows screen
  Then every one of them is listed with its state
  And the list can be filtered to one state
```

The three states are **Import pending**, **Import clean** and **Import
rejected**.

### 1.6.2 Two states are derived, one is stored

```gherkin
Scenario: a row with findings still waiting
  Given patient P-0310 has at least one pending finding
  Then its state is Import pending

Scenario: a row nothing is waiting on
  Given patient P-0044 has no pending finding
  And it has not been rejected
  Then its state is Import clean

Scenario: a row somebody threw out
  Given Vamshi rejects patient P-0781
  Then its state is Import rejected
  And it stays rejected however its findings later settle
```

Pending and clean are read off the findings and are never stored. A stored
"clean" would be wrong the moment 1.2.10's next run finds something new on a row
that was clean a minute ago, and there would then be two answers to the same
question. Rejection is the opposite: nothing can derive it, because it is a
decision somebody made, so it is a column on the row.

### 1.6.3 Expanding a row shows what is waiting on it

```gherkin
Scenario: a row is opened
  Given patient P-0310 has findings from four rules
  When Vamshi expands that row
  Then the findings are shown grouped by the rule that made them
  And each shows the column, the before and the after (1.2.3)
```

The same before and after the rules screen draws (1.2.3), and the same two
presses per finding. What is different is only which findings are gathered
together: one row's, rather than one rule's.

### 1.6.4 Approve all on a row

```gherkin
Scenario: everything proposed on one row is taken
  Given patient P-0310 has six pending findings, two of them from ambiguous rules
  When Vamshi presses Approve all on that row
  Then the four that propose a value are approved and written
  And the two ambiguous ones are left pending
  And the screen says two were left
```

It is exactly the row-level tick (1.2.4) pressed on every finding of that row,
in one transaction (1.2.5), and it is not a new decision: the same result is
reachable by opening each rule in turn and ticking that row. An ambiguous rule
proposes nothing (1.1.12), so there is no tick on it to press and nothing for
this press to apply — those are skipped, and the count of what was skipped is
reported so the press never looks like it finished a row it did not.

**A row carrying an ambiguous finding therefore cannot reach Import clean by
this button.** Somebody has to answer or decline each one. That is the point of
the screen, not a shortcoming of it.

### 1.6.5 Decline all on a row

```gherkin
Scenario: everything proposed on one row is refused
  Given patient P-0310 has six pending findings
  When Vamshi presses Decline all on that row
  Then all six are declined, ambiguous ones included
  And each is declined forever (1.2.9)
```

Unlike the tick, the cross needs no proposal to press, so decline all covers
every pending finding on the row. It declines rows, never rules: the ticked
cross that parks a version (1.2.8) is a judgement about a rule and has no
meaning applied to everything on one patient at once.

### 1.6.6 A row can be rejected

```gherkin
Scenario: a row is not worth migrating
  Given patient P-0781 is beyond repair
  When Vamshi rejects it, with a reason
  Then its state is Import rejected
  And it is not offered for promotion (1.4)
```

Reversible, unlike an accepted change (1.2.11): rejecting a row writes nothing
to the data, so taking it back costs nothing and loses nothing.

### 1.6.7 A field can be corrected by hand

```gherkin
Scenario: a value no rule has an opinion about
  Given patient P-0310 has a city no rule caught
  When Vamshi edits that field and saves
  Then the column is written
  And the modification log records the change like any other (1.3)
```

The engine's one guarantee is that every change to legacy data says which rule,
at which version, changed which column from what to what — the rule row *is* the
log (1.3). A free-form edit has no rule behind it, so it would be the one change
in the system with no answer to "why did this value change".

So a hand edit is written as a finding, under a reserved rule id kept for
exactly this, approved in the same transaction that writes it. The log keeps one
shape, every change is in it, and a hand edit is legible as a hand edit because
of the rule id it carries. This is the same move 1.1.12's typed value makes: the
human's answer enters through the path a rule's answer takes, rather than beside
it.

---

## 1.7 Duplicates

### 1.7.1 A link names two rows

A link carries both legacy ids and both data-row ids. A legacy id names a row
without identifying one (1.0.3): two intakes sharing an intake id, or two consent
events sharing a patient id, are the same legacy id twice.

- v1 of D05 and D06 names the same id twice. All six rules get a v2 that carries
  row ids; v1 stays registered, inactive (1.1.8).
- Persisting a link without both row ids fails the run.

### 1.7.2 Apply rules records links

```gherkin
Scenario: a link is found
  When Apply rules runs
  Then each duplicate link is recorded, pending, in the same transaction as the findings

Scenario: the same pair again
  Given rows A and B are already linked
  When any rule finds A and B again
  Then nothing is recorded

Scenario: a dismissed link
  Given the link between A and B was dismissed
  When any rule, at any version, finds them again
  Then nothing is recorded
```

- One link per pair of rows, whichever rule finds it first.
- Y is the earlier row in export order — the rules' own convention.

### 1.7.3 Status

`pending` → `confirmed` | `dismissed`. Both final.

### 1.7.4 The duplicates screen

- Lists links, filterable by status and source; pending by default. Virtualised.
- Each shows source, X, Y and the rule that found it.
- Expanding shows X and Y side by side, every column, with differing values drawn
  by `ValueDiff`.
- Confirm and Dismiss on pending links.

### 1.7.5 Confirming

```gherkin
Scenario: two patient rows are the same person
  Given P-450 is linked as a duplicate of P-100
  When Vamshi confirms the link
  Then the link is confirmed
  And P-450 is Import rejected, its reason naming P-100 and the rule
```

- Patient: X is rejected on the rows screen (1.6.6). Reversible like any rejection.
- Intake and consent: X and Y share a legacy id, so neither is rejected — a
  rejection would take both. Acceptance skips the confirmed duplicate data row.

### 1.7.6 Dismissing

The link is dismissed and never recorded again (1.7.2). Neither row changes.

### 1.7.7 Merging

Merge rules M01–M07 fill a column of Y that is empty from a confirmed duplicate X.
They are ordinary findings on Y, approved like any other (1.1.13).

- Patients only. Columns: `full_name`, `email`, `dob`, `sex`, `bsn`, `phone`, `city`
  — facts about the person. Not `signup_date`, `source`, `status`, `weight`,
  `height_cm` — facts about a signup.
- Two confirmed duplicates of Y holding different values for the column: that row
  proposes nothing.
- Not ambiguous.

### 1.7.8 Out of scope

- Chains: X linked to Y where Y is itself the duplicate side of another link is
  recorded as found and not resolved transitively.
- Deleting or hiding X's data: never — X stays in its legacy table.

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

One table across all three legacy sources, kept separate so duplicate
information does not pollute every row.

```ts
type Duplicate = {
  id: string
  sourceTable: 'patient' | 'intake' | 'consent'
  duplicateLegacyId: string   // X
  canonicalLegacyId: string   // Y — the one that survives
  ruleId: string
  version: number
}
```

It records a relationship and nothing else. Any data that has to move from X to
Y is an ordinary rule row against Y (1.1.13). Marking X itself retired waits on
a status column that legacy rows do not have yet.
