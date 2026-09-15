# Intake requirements — discussion

Part B, new patient intake. Nothing here is final until moved into
`final-requirements.md` under the same address. Numbers are addresses, not order.
**The doc** = `ASSIGNMENT.md`.

---

## 2.0 Architecture

Two homes for patient data: the **legacy tables** (as imported) and the **main
table** `patient`. Two ways in, one flow after: an intake is written into
`patient` from its first step; a legacy row is imported as a new patient entry
(2.6). Both are evaluated and reviewed the same way.

### Backend modules

| Module | Owns |
|---|---|
| `patient` | `patient` table; intake flow; `intake_status` state machine |
| `eligibility` | ruleset registry (code, versioned), `evaluate(patient)` |
| `consent` | `consent_event` table |
| `audit` | `audit_event` table, append-only writer |
| `legacy-import` | legacy patient → `patient`, individual and bulk |
| `review` | review endpoints over `patient` |

Existing and unchanged: `legacy`, `rules`, `rows`, `duplicates`.

### Frontend routes

| Route | Screen | Audience |
|---|---|---|
| `/intake`, `/intake/:id/:step` | multi-step form (2.3) | patient, no staff nav |
| `/intake/:id/done` | received, neutral status | patient |
| `/review`, `/review/:id` | queue and detail (2.4) | staff |
| `/rows` | gains Import, bulk selection and errors (2.6) | staff |
| `/rules`, `/duplicates` | unchanged | staff |

### Conventions

- Types: ids `text` uuid · dates `text` `YYYY-MM-DD` · timestamps `text` ISO-8601 UTC ·
  booleans `integer` 0/1 · lists `text` simple-json · enums `text` + `CHECK`.
- A write that changes a status or records a decision writes its `audit_event` in
  the same transaction.
- Services own transactions; controllers check request shape; services throw no
  HTTP exceptions (Part A convention).
- `@mantine/form` for the form (tech-stack 4.1).

---

## 2.1 The main table

### 2.1.1 `patient`

| Column | Type | Constraint |
|---|---|---|
| `id` | text | uuid, PK |
| `intake_status` | text | not null, `CHECK` on the 8 states (2.2) |
| `origin` | text | not null, `CHECK IN (intake, legacy)` |
| `full_name` | text | not null |
| `email` | text | not null, unique, lowercased |
| `date_of_birth` | text | `YYYY-MM-DD`, not null |
| `height_cm` | real | null, 1 dp |
| `weight_kg` | real | null, 1 dp |
| `bmi` | real | null, 1 dp |
| `glp1_current` | integer | boolean, null |
| `glp1_medications` | text | simple-json `string[]` |
| `other_medications` | text | null |
| `weight_conditions` | text | simple-json `string[]`, null for legacy |
| `thyroid_cancer_history` | integer | boolean, null |
| `pancreatitis_history` | integer | boolean, null |
| `other_conditions` | text | null |
| `alcohol_units_week` | integer | null |
| `questionnaire_version` | text | null for legacy |
| `ruleset_version` | text | null until evaluated |
| `evaluation` | text | simple-json `[{ruleId, matched, outcome, explanation}]` |
| `sex` | text | null, `CHECK IN ('M','F')` (P23 canonical) |
| `bsn` | text | null, legacy only |
| `phone` | text | null, E.164 |
| `city` | text | null |
| `account_status` | text | not null, `CHECK IN (active, paused, churned, prospect)`; intake → `prospect` |
| `signup_date` | text | null, `YYYY-MM-DD` |
| `acquisition_source` | text | null, lowercased (legacy `source`) |
| `legacy_id` | text | null, unique |
| `created_at`, `submitted_at`, `decided_at`, `updated_at` | text | ISO UTC |

- `intake_status` (where the patient is in intake and review) is not
  `account_status` (commercial, from legacy).
- `origin` not `source`: legacy `source` is the acquisition funnel.
- One row per email. A decision's note lives in `audit_event.reason`.

### 2.1.2 `consent_event`

| Column | Type | Constraint |
|---|---|---|
| `id` | text | uuid, PK |
| `patient_id` | text | FK `patient.id`, not null |
| `type` | text | `CHECK IN ('data_processing')` |
| `action` | text | `CHECK IN ('granted','revoked')` |
| `version` | text | not null |
| `at` | text | ISO UTC, not null |
| `origin` | text | `CHECK IN (intake, legacy)` |
| `legacy_row_id` | text | null; the legacy consent data row |

Append-only history: a patient has many consent events.

---

## 2.2 Intake statuses

| From | To | Actor | Trigger |
|---|---|---|---|
| — | `draft` | patient | step 1 saved (2.3) |
| — | `submitted` | staff | legacy import (2.6) |
| `draft` | `submitted` | patient | submit |
| `submitted` | `auto_cleared` · `auto_flagged` · `auto_rejected` | `system` | evaluation, same transaction |
| `auto_cleared` · `auto_flagged` · `auto_rejected` | `in_review` | reviewer | start review |
| `in_review` | `approved` · `rejected` | reviewer | decide, note required |

Every other pair is illegal. `approved` and `rejected` are terminal. `in_review` =
awaiting a human decision. `auto_rejected` can be reviewed.

### Enforcement — impossible, not avoided

1. `INTAKE_TRANSITIONS` constant: the only definition of legal pairs.
2. `IntakeStateMachine.transition()` is the only write to `intake_status`:
   `UPDATE … WHERE id = :id AND intake_status = :from`, with its audit event, in
   one transaction. 0 rows → 409.
3. SQLite triggers, `CREATE TRIGGER IF NOT EXISTS` on boot:
   - `BEFORE UPDATE OF intake_status` raises unless `(OLD, NEW)` is legal.
   - `BEFORE INSERT` raises unless `origin = 'intake'` and `intake_status = 'draft'`,
     or `origin = 'legacy'` and `intake_status = 'submitted'`.
4. Tests attempt every illegal pair through the service and through raw SQL; both fail.

---

## 2.3 The intake form

Multi-step, one questionnaire step per screen, moving through 2.2.

- Step 1 saved → `POST /intakes` creates the `patient` row, `draft`.
- Email already in `patient` → 409 at step 1.
- Each Next → `PATCH` saves that step; the server validates that step's fields.
- Draft id in the URL and localStorage; resumable; read-only once submitted.
- No BMI and no likely outcome shown before submit — a live verdict invites
  adjusting the weight until it passes.
- After submit the patient sees "received", never the outcome.

### 2.3.1 Questionnaire `q2026.1`

Label distinct from legacy `v1`/`v2` so a stored label is never mistaken for one.

**Step 1 — About you**

| Field | Question | Input | Required |
|---|---|---|---|
| `full_name` | Full name | text | yes |
| `email` | Email address | email | yes |
| `date_of_birth` | Date of birth | date | yes |

**Step 2 — Body**

| Field | Question | Input | Required |
|---|---|---|---|
| `height_cm` | Height (cm) | number | yes |
| `weight_kg` | Weight (kg) | number | yes |

**Step 3 — Medication**

| Field | Question | Input | Required |
|---|---|---|---|
| `glp1_current` | Are you currently using a GLP-1 medication, such as Ozempic, Wegovy or Mounjaro? | yes / no | yes |
| `glp1_medications` | Which? | multi-select: semaglutide (Ozempic, Wegovy, Rybelsus) · tirzepatide (Mounjaro, Zepbound) · liraglutide (Saxenda, Victoza) · dulaglutide (Trulicity) · exenatide (Byetta, Bydureon) · other + text | when yes |
| `other_medications` | Any other medication you currently use? | long text | no |

**Step 4 — Health**

| Field | Question | Input | Required |
|---|---|---|---|
| `weight_conditions` | Have you been diagnosed with any of these? | multi-select: type 2 diabetes · prediabetes · high blood pressure · high cholesterol · sleep apnoea · cardiovascular disease · none of these | yes |
| `thyroid_cancer_history` | Have you ever been diagnosed with thyroid cancer? | yes / no | yes |
| `pancreatitis_history` | Have you ever had pancreatitis? | yes / no | yes |
| `other_conditions` | Any other conditions we should know about? | long text | no |
| `alcohol_units_week` | How many units of alcohol do you drink in a typical week? | whole number | no |

**Step 5 — Consent**

| Field | Question | Input | Required |
|---|---|---|---|
| `consent_data_processing` | I agree to Wellis processing my health data to assess my eligibility. (text `dp-2026.1`) | checkbox | must be checked |

Saving writes a `consent_event granted`.

**Step 6 — Check and submit**: every answer by step, edit link per step, Submit.

Yes/no questions have no default, and "none of these" is an explicit choice: a
deterministic rule must never read an unanswered question as "no".

---

## 2.4 The review view

One queue for both origins.

**Queue** — `GET /review/intakes`

- Default filter: `auto_flagged`, `auto_cleared`, `in_review`; `auto_rejected` selectable.
- Filter by `origin`.
- Columns: submitted, origin, age, BMI, status, matched flags. Oldest first. Virtualised.

**Detail** — `GET /review/intakes/:id`

- Answers grouped by questionnaire step; not-recorded answers marked for legacy rows.
- Evaluation: every rule, matched or not, its explanation, the ruleset version.
- Status history from `audit_event`.

**Actions**

| Button | On | Does |
|---|---|---|
| Start review | `auto_*` | → `in_review`, actor recorded |
| Approve | `in_review` | → `approved` |
| Reject | `in_review` | → `rejected` |

- Approve and Reject disabled until the note is non-empty after trimming.
- Reviewer is a name entered once, kept in localStorage, sent as `actor`.

---

## 2.5 Validation

- **Validation rejects impossible values; eligibility judges possible ones.** Age
  17 or BMI 22 passes validation and reaches `auto_rejected` with an explanation.
- Frontend: `@mantine/form` per step; errors on blur and on Next; Next blocked
  until the step is valid.
- Backend is authoritative: re-validates on every `PATCH` (that step), on submit
  (all steps) and on legacy import. 422 on failure.
- Legacy import applies the identity and body rules; medication and health
  answers may be null.
- Written twice — no shared package (tech-stack 4.10). A contract spec posts each
  invalid fixture and asserts 422 naming that field.

| Field | Rule |
|---|---|
| `full_name` | trim; 2–120 chars; ≥1 letter; no digit; no `@` |
| `email` | trim, lowercase; ≤254; exactly one `@`; domain contains `.`; no whitespace |
| `date_of_birth` | real calendar date; not after today; not before 1900-01-01 |
| `height_cm` | 100–250 |
| `weight_kg` | 30–400 |
| `glp1_medications` | ≥1 when `glp1_current` yes; empty when no |
| `weight_conditions` | ≥1; "none of these" combines with nothing |
| yes / no fields | answered (intake) |
| `alcohol_units_week` | integer 0–200 |
| `consent_data_processing` | checked |
| `sex` (legacy) | null, `M` or `F` |
| `bsn` (legacy) | null, or 9 digits passing the eleven-proef |
| `phone` (legacy) | null, or E.164: `+` then 8–15 digits |
| `account_status` (legacy) | `active` · `paused` · `churned` · `prospect` |
| `signup_date` (legacy) | null, or a real date not after today |
| `weight` (legacy) | `weight_unit` is `kg` |

BMI: `weight_kg / (height_cm / 100)²`, rounded half-up to 1 dp.

---

## 2.6 Importing a legacy patient

Import = a new patient entry through the same flow as an intake. Resolves 2.c.

### Preconditions — per row

- Source is `patient`. Intake rows stay history; consent rows come with their patient.
- Row state is Import clean: no pending finding, not rejected, not imported.
- The legacy id names exactly one data row (1.0.3).
- Its consent row (same legacy id) has no pending finding.
- A confirmed duplicate X is already Import rejected (1.7.5), so it never qualifies.

Failed precondition → 409 with the reason.

### Flow — one transaction per row

1. Validate (2.5).
2. Insert `patient`: `origin legacy`, `intake_status submitted`.
3. Insert the patient's legacy consent events, skipping confirmed duplicate rows
   (1.7.5). An event failing 2.1.2's constraints fails the import with a field
   error naming that event.
4. Evaluate (2.7): `submitted` → `auto_*`, into the review queue like any intake.
5. `audit_event` for the import and the transition, actor = staff name.

### Mapping

| Legacy | `patient` |
|---|---|
| `full_name`, `email`, `sex`, `bsn`, `phone`, `city`, `height_cm`, `signup_date`, `legacy_id` | same name |
| `dob` | `date_of_birth` |
| `weight` (unit `kg`) | `weight_kg` |
| `status` | `account_status` |
| `source` | `acquisition_source` |
| latest legacy intake `meds_current` | `other_medications` |
| latest legacy intake `conditions` | `other_conditions` |

Free text is never parsed into answers (I26, I29): `glp1_current`,
`weight_conditions`, `thyroid_cancer_history`, `pancreatitis_history` stay null.

### Individual and bulk

- Individual: an Import button on each Import clean patient row →
  `POST /rows/patient/:legacyId/import`.
- Bulk: a checkbox on each Import clean patient row, select-all over the loaded
  clean rows, **Import selected** → `POST /rows/import` `{ legacyIds }`.
- Bulk runs each row in its own transaction: one bad row never blocks the rest.
- Response per row: `{ legacyId, imported: true, patientId, intakeStatus }` or
  `{ legacyId, imported: false, errors: [{ field, value, reason }] }`.

### Errors

- Invalid data → 422 (individual) or that row's `errors` (bulk).
- Every field error collected in one pass, not the first only.
- Database constraint errors (unique email) caught and returned as a field error.
- A failed row writes nothing. Nothing leaks as a 500.
- UI: failed rows list each field, its value (drawn with `ValueDiff`) and the
  reason; they stay Import clean and stay selected for a retry.

### Imported state

- Derived: a legacy patient row is imported when `patient.legacy_id` names it.
- Rows screen fourth state **Imported**. Precedence: imported > rejected >
  pending > clean. Final: no actions; `persist()` records no finding against it.

---

## 2.7 Eligibility engine

Separate from the Part A rules engine: a Part A rule proposes a change and waits
for a human; a ruleset classifies a submission on the spot.

- Rulesets are code, registered by version; every version stays registered.
- `ACTIVE_RULESET = 'elig-1'`. Changing a threshold is a new version.
- Evaluated once, at submit or import; the row stores `ruleset_version` and every
  rule's result.
- Never re-evaluated.

### `elig-1`

| Rule | Condition | Outcome | Explanation |
|---|---|---|---|
| E1 | age < 18 | reject | `rejected: age 17 at submission, under 18` |
| E2 | BMI < 27.0 | reject | `rejected: BMI 25.3, below 27` |
| E3 | 27.0 ≤ BMI ≤ 30.0 and `weight_conditions` = none | flag | `flagged: BMI 27.4 with no weight-related condition` |
| E4 | `glp1_current` yes | flag | `flagged: currently using a GLP-1 medication (semaglutide)` |
| E5 | thyroid cancer or pancreatitis history | flag | `flagged: self-reported history of pancreatitis` |
| — | nothing matched | clear | `cleared: no rule matched, for doctor review` |

- **A missing answer never clears a rule.** A null answer a rule needs matches it
  as a flag: `flagged: GLP-1 use not recorded (legacy)`. A legacy import is
  therefore flagged or rejected, never cleared.
- Outcome: any reject → `auto_rejected`; else any flag → `auto_flagged`; else `auto_cleared`.
- All five always run; every result stored, so a reviewer sees every reason.
- Age: whole years from `date_of_birth` to the submission date, UTC.
- BMI **compared rounded** — otherwise 26.96 shows "27.0" and rejects as below 27.

---

## 2.8 Audit log

Every state change and every human decision.

| Column | Type | Constraint |
|---|---|---|
| `id` | text | uuid, PK |
| `entity` | text | `CHECK IN (patient, consent_event)` |
| `entity_id` | text | not null |
| `action` | text | `CHECK IN (create, import, transition, decision)` |
| `from_state` | text | null |
| `to_state` | text | null |
| `actor` | text | `system`, `patient`, or a staff name |
| `reason` | text | null; required for `decision` |
| `at` | text | ISO UTC |

- Written in the transaction of the change it records.
- Append-only: triggers raise on `UPDATE` and `DELETE`.
- Part A's rule rows stay the log of legacy value changes (1.3); the patient
  history (Part C) reads both.

---

## 2.9 API

| Method | Path | Does | Errors |
|---|---|---|---|
| POST | `/intakes` | step 1 → `patient` row, `draft` | 409 email taken · 422 |
| PATCH | `/intakes/:id` | save one step | 409 not draft · 422 |
| POST | `/intakes/:id/submit` | validate all, `submitted` → `auto_*` | 409 · 422 |
| GET | `/intakes/:id` | patient view, neutral status | 404 |
| GET | `/review/intakes` | queue, status and origin filters | 400 |
| GET | `/review/intakes/:id` | answers, evaluation, history | 404 |
| POST | `/review/intakes/:id/start` | `auto_*` → `in_review` | 409 |
| POST | `/review/intakes/:id/decide` | `{ decision, note, actor }` | 409 · 422 |
| POST | `/rows/patient/:legacyId/import` | import one (2.6) | 409 · 422 |
| POST | `/rows/import` | `{ legacyIds, actor }`, per-row results | 400 |

422 body everywhere: `{ message, errors: [{ field, value, reason }] }`.

---

## Limits

- No authentication: a draft is reached by uuid; `actor` is a typed name.
- A ruleset change does not re-evaluate past rows.
- One row per email: an abandoned draft holds its email; clearing stale drafts
  is deferred.
- Legacy intakes are not migrated into `patient`; they remain history.
- Work queue across Part A and B, conflict view, patient detail: Part C.

---

## Tasks

| Id | Task | Nodes |
|---|---|---|
| B1 | Entities `patient`, `consent_event`, `audit_event`; boot triggers; state machine; audit writer | 2.1, 2.2, 2.8 |
| B2 | Backend validators; eligibility engine `elig-1` | 2.5, 2.7 |
| B3 | Intake API and review API | 2.3, 2.4, 2.9 |
| B4 | Legacy import, individual and bulk; Imported state | 2.6 |
| B5 | Intake form UI | 2.3, 2.5 |
| B6 | Review UI | 2.4 |
| B7 | Rows screen: Import, checkboxes, select all, Import selected, errors | 2.6 |
