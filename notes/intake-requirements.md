# Intake requirements — discussion

Part B, new patient intake. Nothing here is final until moved into
`final-requirements.md` under the same address. Numbers are addresses, not order.
**The doc** = `ASSIGNMENT.md`.

---

## 2.0 Architecture

### Backend modules

| Module | Owns |
|---|---|
| `patient` | `patient` table; create-or-link on approval and on acceptance |
| `intake` | `intake` table, questionnaire `q2026.1`, state machine, submit |
| `eligibility` | ruleset registry (code, versioned), `evaluate(intake)` |
| `consent` | `consent_event` table |
| `audit` | `audit_event` table, append-only writer |
| `acceptance` | `row_acceptance` table, legacy → final mapping |
| `review` | review endpoints over `intake` |

Existing and unchanged: `legacy`, `rules`, `rows`.

### Frontend routes

| Route | Screen | Audience |
|---|---|---|
| `/intake`, `/intake/:id/:step` | multi-step form (2.3) | patient, no staff nav |
| `/intake/:id/done` | received, neutral status | patient |
| `/review`, `/review/:id` | queue and detail (2.4) | staff |
| `/rows` | gains Accept and its errors (2.6) | staff |
| `/rules` | unchanged | staff |

### Conventions

- Types: ids `text` uuid · dates `text` `YYYY-MM-DD` · timestamps `text` ISO-8601 UTC ·
  booleans `integer` 0/1 · lists `text` simple-json · enums `text` + `CHECK`.
- A write that changes a status or records a decision writes its `audit_event` in
  the same transaction.
- Services own transactions; controllers check request shape; services throw no
  HTTP exceptions (Part A convention).
- `@mantine/form` added for the form — amends tech-stack 4.1.

---

## 2.1 The final tables

One `patient` table for both origins. A legacy row enters it by acceptance (2.6),
an intake by approval (2.4) — both pass the same validation (2.5). Resolves the
earlier open question.

### 2.1.1 `patient`

| Column | Type | Constraint |
|---|---|---|
| `id` | text | uuid, PK |
| `full_name` | text | not null |
| `email` | text | not null, unique, lowercased |
| `date_of_birth` | text | `YYYY-MM-DD`, not null |
| `sex` | text | null, `CHECK IN ('M','F')` (P23 canonical) |
| `bsn` | text | null, legacy only |
| `phone` | text | null, E.164 |
| `city` | text | null |
| `height_cm` | real | null, last known |
| `weight_kg` | real | null, last known |
| `account_status` | text | not null, `CHECK IN (active, paused, churned, prospect)` |
| `signup_date` | text | null, `YYYY-MM-DD` |
| `acquisition_source` | text | null, lowercased (legacy `source`) |
| `origin` | text | not null, `CHECK IN (legacy, intake)` |
| `legacy_source_table` | text | null |
| `legacy_id` | text | null; `(legacy_source_table, legacy_id)` unique when set |
| `created_at`, `updated_at` | text | ISO UTC |

`origin` not `source`: legacy `source` is the acquisition funnel.

### 2.1.2 `intake`

| Column | Type | Constraint |
|---|---|---|
| `id` | text | uuid, PK |
| `status` | text | not null, `CHECK` on the 8 states (2.2) |
| `origin` | text | `CHECK IN (intake, legacy)` |
| `questionnaire_version` | text | not null |
| `ruleset_version` | text | null until evaluated; null for legacy |
| `full_name`, `email`, `date_of_birth` | text | as `patient` |
| `height_cm`, `weight_kg` | real | stored rounded to 1 dp |
| `height_entered`, `weight_entered` | text | simple-json `{value, unit}` as typed |
| `bmi` | real | 1 dp; null for legacy |
| `glp1_current` | integer | boolean; null for legacy |
| `glp1_medications` | text | simple-json `string[]` |
| `other_medications` | text | null; legacy `meds_current` lands here |
| `weight_conditions` | text | simple-json `string[]` |
| `thyroid_cancer_history` | integer | boolean; null for legacy |
| `pancreatitis_history` | integer | boolean; null for legacy |
| `other_conditions` | text | null; legacy `conditions` lands here |
| `alcohol_units_week` | integer | null |
| `evaluation` | text | simple-json `[{ruleId, matched, outcome, explanation}]` |
| `patient_id` | text | FK `patient.id`, null until approved |
| `legacy_intake_id` | text | null |
| `created_at`, `submitted_at`, `decided_at` | text | ISO UTC |

No note column: a decision's note is `audit_event.reason`.

### 2.1.3 `consent_event`

| Column | Type | Constraint |
|---|---|---|
| `id` | text | uuid, PK |
| `patient_id` | text | FK, null |
| `intake_id` | text | FK, null; `CHECK` at least one of the two |
| `type` | text | `CHECK IN ('data_processing')` |
| `action` | text | `CHECK IN ('granted','revoked')` |
| `version` | text | not null |
| `at` | text | ISO UTC, not null |
| `origin` | text | `CHECK IN (legacy, intake)` |
| `legacy_id` | text | null |

Append-only, like the legacy consents it mirrors. Intake consent carries
`intake_id`; approval sets `patient_id`.

---

## 2.2 Intake statuses

| From | To | Actor | Trigger |
|---|---|---|---|
| — | `draft` | patient | consent given (2.3) |
| `draft` | `submitted` | patient | submit |
| `submitted` | `auto_cleared` · `auto_flagged` · `auto_rejected` | `system` | evaluation, same transaction as submit |
| `auto_cleared` · `auto_flagged` · `auto_rejected` | `in_review` | reviewer | start review |
| `in_review` | `approved` · `rejected` | reviewer | decide, note required |
| — | `approved` · `rejected` · `in_review` | `legacy-import` | legacy acceptance (2.6) |

Every other pair is illegal. `approved` and `rejected` are terminal. `in_review` =
awaiting a human decision. `auto_rejected` can still be reviewed — a mistyped
date of birth rejects wrongly.

### Enforcement — impossible, not avoided

1. `INTAKE_TRANSITIONS` constant: the only definition of legal pairs.
2. `IntakeStateMachine.transition()` is the only write to `status`:
   `UPDATE … WHERE id = :id AND status = :from`, with its audit event, in one
   transaction. 0 rows → 409.
3. SQLite triggers, `CREATE TRIGGER IF NOT EXISTS` on boot:
   - `BEFORE UPDATE OF status` raises unless `(OLD.status, NEW.status)` is legal.
   - `BEFORE INSERT` raises unless `status = 'draft'`, or `origin = 'legacy'` and
     status is in the legacy set.
4. Tests attempt every illegal pair through the service and through raw SQL; both fail.

---

## 2.3 The intake form

Multi-step, one questionnaire step per screen, moving through 2.2.

- Consent is step 1: nothing health-related is stored before consent to process it.
- Consent given → `POST /intakes` creates the `draft` and a `consent_event granted`.
- Each Next → `PATCH` saves that step; the server validates that step's fields.
- Draft id in the URL and localStorage; resumable; read-only once submitted.
- No BMI and no likely outcome shown before submit — a live verdict invites
  adjusting the weight until it passes.
- After submit the patient sees "received", never the outcome.

### 2.3.1 Questionnaire `q2026.1`

Label distinct from legacy `v1`/`v2` so a stored label is never mistaken for one.

**Step 1 — Consent**

| Field | Question | Input | Required |
|---|---|---|---|
| `consent_data_processing` | I agree to Wellis processing my health data to assess my eligibility. (text `dp-2026.1`) | checkbox | must be checked |

**Step 2 — About you**

| Field | Question | Input | Required |
|---|---|---|---|
| `full_name` | Full name | text | yes |
| `email` | Email address | email | yes |
| `date_of_birth` | Date of birth | date | yes |

**Step 3 — Body**

| Field | Question | Input | Required |
|---|---|---|---|
| `height` | Height | number + unit `cm` · `ft + in` | yes |
| `weight` | Weight | number + unit `kg` · `lb` | yes |

**Step 4 — Medication**

| Field | Question | Input | Required |
|---|---|---|---|
| `glp1_current` | Are you currently using a GLP-1 medication, such as Ozempic, Wegovy or Mounjaro? | yes / no | yes |
| `glp1_medications` | Which? | multi-select: semaglutide (Ozempic, Wegovy, Rybelsus) · tirzepatide (Mounjaro, Zepbound) · liraglutide (Saxenda, Victoza) · dulaglutide (Trulicity) · exenatide (Byetta, Bydureon) · other + text | when yes |
| `other_medications` | Any other medication you currently use? | long text | no |

**Step 5 — Health**

| Field | Question | Input | Required |
|---|---|---|---|
| `weight_conditions` | Have you been diagnosed with any of these? | multi-select: type 2 diabetes · prediabetes · high blood pressure · high cholesterol · sleep apnoea · cardiovascular disease · none of these | yes |
| `thyroid_cancer_history` | Have you ever been diagnosed with thyroid cancer? | yes / no | yes |
| `pancreatitis_history` | Have you ever had pancreatitis? | yes / no | yes |
| `other_conditions` | Any other conditions we should know about? | long text | no |
| `alcohol_units_week` | How many units of alcohol do you drink in a typical week? | whole number | no |

**Step 6 — Check and submit**: every answer by step, edit link per step, Submit.

Yes/no questions have no default, and "none of these" is an explicit choice: a
deterministic rule must never read an unanswered question as "no".

---

## 2.4 The review view

**Queue** — `GET /review/intakes`

- Default filter: `auto_flagged`, `auto_cleared`, `in_review`; `auto_rejected` selectable.
- Columns: submitted, age, BMI, status, matched flags. Oldest first. Virtualised.

**Detail** — `GET /review/intakes/:id`

- Answers grouped by questionnaire step.
- Evaluation: every rule, matched or not, its explanation, the ruleset version.
- Status history from `audit_event`.

**Actions**

| Button | On | Does |
|---|---|---|
| Start review | `auto_*` | → `in_review`, actor recorded |
| Approve | `in_review` | → `approved`; patient create-or-link by email; `consent_event.patient_id` set |
| Reject | `in_review` | → `rejected`; no patient |

- Approve and Reject disabled until the note is non-empty after trimming.
- Approve is one transaction; a patient-creation failure rolls back and is shown
  as in 2.6.
- Existing `patient` with the same email → linked, not duplicated. Else created,
  `origin intake`, `account_status prospect`.
- Reviewer is a name entered once, kept in localStorage, sent as `actor`.

---

## 2.5 Validation

- **Validation rejects impossible values; eligibility judges possible ones.** Age
  17 or BMI 22 passes validation and reaches `auto_rejected` with an explanation.
- Frontend: `@mantine/form` per step; errors on blur and on Next; Next blocked
  until the step is valid.
- Backend is authoritative: re-validates on every `PATCH` (that step) and on
  submit (all steps). 422 on failure.
- Same rules gate legacy acceptance (2.6) and patient creation on approval (2.4).
- Written twice — no shared package (tech-stack 4.10). A contract spec posts each
  invalid fixture and asserts 422 naming that field.

| Field | Rule |
|---|---|
| `full_name` | trim; 2–120 chars; ≥1 letter; no digit; no `@` |
| `email` | trim, lowercase; ≤254; exactly one `@`; domain contains `.`; no whitespace |
| `date_of_birth` | real calendar date; not after today; not before 1900-01-01 |
| `height` | 100–250 cm after conversion; `ft` 3–8, `in` 0–11 |
| `weight` | 30–400 kg after conversion |
| `glp1_medications` | ≥1 when `glp1_current` yes; empty when no |
| `weight_conditions` | ≥1; "none of these" combines with nothing |
| yes / no fields | answered |
| `alcohol_units_week` | integer 0–200 |
| `consent_data_processing` | checked |
| `sex` (legacy) | `M` or `F` |
| `bsn` (legacy) | 9 digits; passes the eleven-proef |
| `phone` (legacy) | E.164, `+` then 8–15 digits |
| `account_status` (legacy) | `active` · `paused` · `churned` · `prospect` |
| `signup_date` (legacy) | real date; not after today |

Conversions: `lb × 0.45359237`; `(ft × 12 + in) × 2.54`; rounded half-up to 1 dp.
BMI is computed from the stored rounded values, so they reproduce it.

---

## 2.6 Accepting an import row into the final table

`POST /rows/:table/:legacyId/accept`

### Preconditions — 409 with the reason

- Row state is Import clean: no pending finding, not rejected, not accepted.
- The legacy id names exactly one data row (1.0.3).
- Not the duplicate side of a `duplicate` link (1.1.13).

### Mapping

| Source | Target | Requires |
|---|---|---|
| patient | `patient`, `origin legacy`, `account_status` ← legacy `status` | every column passes 2.5; `weight_unit` is `kg` |
| intake | `intake`, `origin legacy`, status ← outcome: `approved`→`approved`, `rejected`→`rejected`, `pending`→`in_review` | its patient already accepted; outcome is one of the three |
| consent | `consent_event`, `origin legacy` | its patient already accepted; action is `granted` or `revoked`; `at` is ISO |

Legacy free text is never parsed into answers: `glp1_current`, `thyroid_cancer_history`,
`pancreatitis_history` stay null (I26, I29). `reviewer_note` → the acceptance audit
event's `reason`.

### Transaction

Validate every column → insert target → insert `row_acceptance` → `audit_event`
(`legacy_row`, `accept`). Any failure → rollback, nothing written.

### Errors — the user's requirement

- Invalid data → 422 `{ message, errors: [{ field, value, reason }] }`.
- Every field error collected in one pass, not the first only.
- Database constraint errors (unique email) caught and returned as a field error.
- Nothing leaks as a 500.
- UI: Accept on Import clean rows; on 422 an alert lists each field, its value
  (drawn with `ValueDiff`, so invisible characters show) and the reason; the row
  stays Import clean.

### `row_acceptance`

| Column | Type | Constraint |
|---|---|---|
| `source_table` | text | PK |
| `legacy_id` | text | PK |
| `target_table` | text | `CHECK IN (patient, intake, consent_event)` |
| `target_id` | text | not null |
| `accepted_at` | text | ISO UTC |

Rows screen gains a fourth state, **Imported**. Precedence: imported > rejected >
pending > clean. Final: no actions, skipped by Apply rules.

---

## 2.7 Eligibility engine

Separate from the Part A rules engine: a Part A rule proposes a change and waits
for a human; a ruleset classifies a submission on the spot. Resolves 2.a.

- Rulesets are code, registered by version; every version stays registered.
- `ACTIVE_RULESET = 'elig-1'`. Changing a threshold is a new version.
- Evaluated once, at submit; the intake stores `ruleset_version` and every rule's result.
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

- Outcome: any reject → `auto_rejected`; else any flag → `auto_flagged`; else `auto_cleared`.
- All five always run; every result stored, so a reviewer sees every reason.
- Age: whole years from `date_of_birth` to the `submitted_at` date, UTC.
- BMI: `weight_kg / (height_cm / 100)²`, rounded half-up to 1 dp, **compared
  rounded** — otherwise 26.96 shows "27.0" and rejects as below 27.

---

## 2.8 Audit log

Every state change and every human decision. Resolves 2.b.

| Column | Type | Constraint |
|---|---|---|
| `id` | text | uuid, PK |
| `entity` | text | `CHECK IN (intake, patient, consent_event, legacy_row)` |
| `entity_id` | text | not null |
| `action` | text | `CHECK IN (create, transition, decision, accept)` |
| `from_state` | text | null |
| `to_state` | text | null |
| `actor` | text | `system`, `legacy-import`, or a reviewer name |
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
| POST | `/intakes` | consent → `draft` | 422 |
| PATCH | `/intakes/:id` | save one step | 409 not draft · 422 |
| POST | `/intakes/:id/submit` | validate all, `submitted` → `auto_*` | 409 · 422 |
| GET | `/intakes/:id` | patient view, neutral status | 404 |
| GET | `/review/intakes` | queue, status filter | 400 |
| GET | `/review/intakes/:id` | answers, evaluation, history | 404 |
| POST | `/review/intakes/:id/start` | `auto_*` → `in_review` | 409 |
| POST | `/review/intakes/:id/decide` | `{ decision, note, actor }` | 409 · 422 |
| POST | `/rows/:table/:legacyId/accept` | 2.6 | 409 · 422 |

422 body everywhere: `{ message, errors: [{ field, value, reason }] }`.

---

## Limits

- No authentication: a draft is reached by uuid; `actor` is a typed name.
- A ruleset change does not re-evaluate past intakes.
- Legacy weights in lbs cannot be accepted until a pounds→kg rule exists
  (`rule-catalogue.md`, its unsatisfiable constraint).
- The duplicate side of a link is refused, never merged (deferred D5).
- A returning patient with a new email becomes a new patient — the ops team's
  retry case stays a duplicates problem.
- Work queue across Part A and B, conflict view, patient detail: Part C.

---

## Tasks

| Id | Task | Nodes |
|---|---|---|
| B1 | Entities `patient`, `intake`, `consent_event`, `row_acceptance`, `audit_event`; boot triggers | 2.1, 2.2, 2.6, 2.8 |
| B2 | Backend validators and invalid fixtures | 2.5 |
| B3 | Intake state machine and audit writer | 2.2, 2.8 |
| B4 | Eligibility engine `elig-1` | 2.7 |
| B5 | Intake API: create, patch, submit | 2.3, 2.9 |
| B6 | Acceptance service, endpoint, rows screen Imported state | 2.6 |
| B7 | Review API: queue, detail, start, decide with patient create-or-link | 2.4 |
| B8 | Intake form UI with `@mantine/form` | 2.3, 2.5 |
| B9 | Review UI | 2.4 |
| B10 | Accept button and error display on the rows screen | 2.6 |
