# Tasks

Built from `final-requirements.md`. Each task is one unit of work, sized to fit a
single agent's context. Every task names the requirements it satisfies, so an
agent can be handed the task and the requirement addresses and nothing else.

Phases run in order. Tasks inside a phase may run in parallel unless the task
says otherwise.

Definition of done, for every task: it builds, it passes `just test`, the
committed code satisfies every requirement address it names, and it invents
nothing the requirements do not state.

---

## Phase 1 — Legacy data in the database

### T1.1 Legacy data entities
Three TypeORM entities: `legacy_patient`, `legacy_intake`, `legacy_consent`.
Each has our own `id`, the legacy id, every column from the export as text, and
`rawData`.

- Satisfies: database structure, 1.0.1
- Columns come from `legacy_export/EXPORT-NOTES.md`. Every column is text — no
  parsing, no coercion, no dates. Rules do that work later, not the schema.
- The legacy id is **not** unique. 1.0.3 requires two rows to share one.
- Tests: none beyond the schema syncing against a temp database.

### T1.2 Bulk import script
A script that loads all three files into the entities from T1.1.

- Satisfies: 1.0.1, 1.0.2, 1.0.3, 1.0.4, 1.0.5
- Read the whole file, collect the ids, resolve which already exist in **one**
  query, bulk-insert the remainder. Never row by row.
- Report rows read, inserted, skipped. They must reconcile.
- Values are never compared; the id being present is the whole test.
- Ids are never de-duplicated within the batch.
- Tests, against a temp database: a clean import inserts everything; a second run
  inserts nothing; a file with a repeated id inserts both rows; an id present
  with different values is skipped and the stored values are unchanged.

---

## Phase 2 — Rules storage

### T2.1 Rule and version entities
`rule` and `rule_version` exactly as the database structure section describes.

- Satisfies: 1.1.1, 1.1.8, 1.1.12, 1.2.6
- Exactly one version per rule is active. Enforce it in the write path, not by
  hoping.
- Tests: activating a version deactivates the previous one.

### T2.2 Per-source rule entities
`legacy_patient_rule`, `legacy_intake_rule`, `legacy_consent_rule`.

- Satisfies: database structure, 1.1.7, 1.1.12, 1.2.7
- Identical shape across the three. Share it rather than writing it out three
  times.
- Tests: none beyond the schema syncing.

### T2.3 Duplicates entity
One table across all three sources, recording that X duplicates Y.

- Satisfies: 1.1.13, database structure
- A link only. It changes no column of either row.
- Nothing retires X — legacy rows have no status column (`deferred.md` D5).
- Tests: none beyond the schema syncing.

---

## Phase 3 — Rule execution

### T3.1 Rule interface and registry
The type a rule implements, and how the runner gets from `(ruleId, version)` to
that code.

- Satisfies: 1.1.1, 1.1.2, 1.1.3, 1.1.6, 1.1.7, 1.1.14
- A rule is one function, called **once**. It reads whole tables and returns
  every change it found in one response. It writes nothing.
- It returns `{ ambiguity, updates[] }`. Ambiguity is one flag for the whole
  response, not per update. Each update is
  `{ table, legacyId, column, prev, next }`.
- The registry maps `(ruleId, version)` to a function. Old versions stay
  registered forever — history points at them.
- Tests: a fake rule resolves by key; a missing key fails loudly.

### T3.2 The runner
Calls every active rule version and collects what comes back.

- Satisfies: 1.1.11, 1.1.14, 1.2.10
- The runner knows nothing about any rule. It calls them blindly and does no
  per-row work of its own.
- Runs against the current data, not a snapshot.
- Tests: only active versions run; an inactive version is skipped; a rule
  returning 340 changes is called exactly once.

### T3.3 Findings persistence
Takes the runner's JSON and writes rule rows.

- Satisfies: 1.1.3, 1.2.9
- This is where the declined-row skip lives — `(legacyId, ruleId, column)`,
  ignoring version. Never in rule code.
- Tests: a finding for a row with an existing declined entry is dropped, even
  under a newer rule version; a finding for an untouched row is written as
  pending.

### T3.4 Apply-rules endpoint
One endpoint that runs T3.2 and T3.3 over the whole dataset.

- Satisfies: 1.2.10
- Depends on T3.2 and T3.3.

---

## Phase 4 — Decisions

Every task in this phase is an endpoint plus its tests. They are the parts that
must be provably correct, so the tests matter more than the code.

### T4.1 Approve
Rule-level and row-level.

- Satisfies: 1.2.4, 1.2.5, 1.3
- The rule row's status and the data row's column are written in **one
  transaction**. If either fails, neither applies.
- Rule-level approve takes only what is still pending.
- Tests: approving a rule moves every pending row and updates every column;
  approving one row leaves the rest pending; a forced failure mid-transaction
  leaves both the rule row and the data row untouched.

### T4.2 Decline a rule
- Satisfies: 1.2.6, 1.1.8
- Version goes inactive, `needsReview` true, reason stored if given. The reason
  is optional.
- Tests: with and without a reason; the rule is not deleted.

### T4.3 Decline a row
The cross, checkbox unticked.

- Satisfies: 1.2.7, 1.2.9
- That rule row goes declined with its optional reason. The rule is untouched.
- Tests: the rule's other rows stay pending and approvable; a later version
  produces no finding for that row.

### T4.4 Exclude a row and revise the rule
The cross, checkbox ticked.

- Satisfies: 1.2.8
- The row is **not** declined. The rule's active version goes inactive with
  `needsReview` true and the reason stored against the version.
- Tests: the row stays eligible; after a new version is activated, a run produces
  a pending finding for exactly that row.

---

## Phase 5 — Read endpoints for the screen

### T5.1 Rules list
- Satisfies: 1.2.1
- Joins `rule`, `rule_version` and the per-source rule tables. Active versions
  with at least one pending row. Sorted by pending count, most first.
- Tests: a rule with nothing pending does not appear; an inactive version does
  not appear; ordering is by count.

### T5.2 Rule detail
- Satisfies: 1.2.2, 1.2.3, 1.1.12
- Pending rows and approved rows as two sections. Each row carries
  `previousValue` and `nextValue`.
- An ambiguous rule's rows carry no `nextValue`; the rule's description is what
  the screen shows instead.

---

## Phase 6 — Review console

### T6.1 Rules list screen
- Satisfies: 1.2.1
- Reads T5.1. Sorted list, count per rule, expandable.

### T6.2 Rule detail and row actions
- Satisfies: 1.2.2, 1.2.3, 1.2.4, 1.2.7
- Pending and approved sections. Before and after per row. A tick and a cross on
  every row. Approve and Decline on the rule.

### T6.3 Decline dialog
- Satisfies: 1.2.6, 1.2.8
- Optional reason. The "modify the rule" checkbox on the row cross.

### T6.4 Apply rules button
- Satisfies: 1.2.10
- Calls T3.4 and refreshes.

---

## Phase 7 — Revision

### T7.1 Revision workflow
An agent workflow, run manually, that reads every version with `needsReview` true
and writes the next version.

- Satisfies: 1.5.1, 1.5.2
- Creates a new version, registers its code, activates it, clears `needsReview`.
- May instead narrow the old rule and create a new rule alongside it.
- No schedule, no trigger on write.

---

## Not in this list

- Writing rules. This body of work is the infrastructure rules run on, not the
  rules. Tests use fake rules; real ones come later and separately.
- The main table and promotion (1.4) — next phase, not designed.
- Part B and Part C — not specified.
- Everything in `deferred.md`.
