# Import report

The state of the legacy migration as of 2026-09-16, read from the database after
**Apply rules**. Numbers move as reviewers approve and decline; the Rules and Rows
screens always show the current figures.

## What came in

| File | Rows | Into |
|---|---|---|
| `patients.csv` | 2,466 patients, every legacy id distinct | `legacy_patient` |
| `intakes.csv` | 2,917 intakes, every intake id distinct | `legacy_intake` |
| `consents.jsonl` | 2,643 consent events for 2,367 patients | `legacy_consent` |

Every row keeps the source exactly as it arrived in `raw_data`, which is never
written after import. The import is idempotent: an id already in the database is
skipped, so a second run inserts nothing.

## Rules applied

130 rules are registered, each one fix on one kind of problem:

| Family | Rules | Ambiguous (propose nothing) |
|---|---|---|
| Patients (P) | 66 | 37 |
| Intakes (I) | 38 | 21 |
| Consents (C) | 13 | 9 |
| Duplicates (D) | 6 | — they propose links |
| Merges (M) | 7 | 0 |

The full list, with what each catches and proposes, is
[`notes/rule-catalogue.md`](notes/rule-catalogue.md). 127 rule versions are active.
Three versions are parked in the revision queue after a reviewer declined them:
P47 v2, I34 v1 and C09 v1.

## What was cleaned

4,900 changes have been approved and written, each recorded with its rule, version,
column, old value and new value:

| Rule | What it fixed | Rows |
|---|---|---|
| P23 | Patient `sex` in a recognised but non-canonical spelling → `M` / `F` | 2,001 |
| I35 | Intake `outcome` in a recognised spelling → approved / rejected / pending | 1,472 |
| P55 | Patient `status` in a recognised spelling → active / paused / churned / prospect | 1,426 |
| P12 | A patient email that was not an email address (answered by hand) | 1 |

Two findings were declined (one P12 email, one C09 consent timestamp).

## What is waiting for a decision

14,378 findings are pending, and nothing in them has been applied. The largest:

| Rule | Finding | Pending |
|---|---|---|
| I19 ✱ | Intake weight has no unit column to say what it is measured in | 2,911 |
| I29 ✱ | Intake conditions are free text, Dutch and English mixed | 2,382 |
| I26 ✱ | Intake medication is free text, never normalised | 2,283 |
| I36 ✱ | Intake outcome matches no known value | 805 |
| P30 | Phone with spaces, dots, dashes or brackets | 763 |
| P32 | Dutch national phone number with no country code | 496 |
| P56 ✱ | Patient status matches no known value | 491 |
| I14 ✱ / I12 | Questionnaire version empty / written loosely | 410 / 394 |
| I25 | Intake medication written as a way of saying nothing (`geen`, `n/a`) | 346 |
| I34 ✱ / I32 ✱ | Alcohol units empty / written in words | 290 / 272 |
| P18 ✱ / P60 ✱ / I08 ✱ | A date of birth, signup date or submission date that reads both ways round | 277 / 250 / 172 |
| P59, P17, P58, P16, I07, I06 | A non-ISO date whose order is certain | 999 in all |
| P66 | Weight recorded in pounds: weight in kg and unit `kg`, as one fix | 55 patients |
| P45 ✱ | Weight empty | 105 |
| P03 | Name with stray whitespace | 72 |

✱ = ambiguous: the rule proposes no value, and a person supplies one with a note.

## What is quarantined

A legacy patient can be imported only when nothing is pending on it, it is not
rejected, no duplicate link on it is pending, and its values pass validation.
Intakes and consents are not imported on their own; they stay as history.

| Table | Pending | Clean | Rejected | Imported |
|---|---|---|---|---|
| Patients | 2,038 | 427 | 0 | 1 |
| Intakes | 2,917 | 0 | 0 | — |
| Consents | 69 | 2,298 | 0 | — |

75 duplicate links wait for a person to confirm or dismiss them: 47 patients sharing
an email (D01), 17 sharing a BSN (D02), 10 sharing a phone (D04), and 1 sharing a
name and date of birth (D03). A patient with a pending link cannot be imported.

## What `EXPORT-NOTES.md` did not warn about

- **Duplicates with the same email, BSN and phone.** The notes expected people who
  signed up twice with *different* emails. There are also 47 same-email pairs, 17
  same-BSN pairs and 10 same-phone pairs.
- **Blank weight units that look like pounds.** The unit was backfilled "where
  obvious". The 18 weights left blank are all between 140 and 320: read as
  kilograms they give BMIs of 57 to 93, read as pounds 26 to 42. The rows left blank
  look like the pounds rows rather than a random remainder, so kilograms is not
  assumed for a blank unit, and those rows wait for a person. Separately, the 55
  weights recorded in pounds have a conversion to kilograms proposed.
- **Intakes record weight with no unit at all.** Intakes carry no unit column, so
  all 2,911 intake weights are flagged (I19).
- **Timestamps in the future.** 64 consent events are dated in the future (C09), as
  are 5 dates of birth (P20), 3 signup dates (P61) and 3 intake submissions (I09).
- **Impossible orderings.** 5 consent events predate the patient's signup (C10), and
  5 patients signed up before they were born (P62).
- **Values outside every known spelling.** Beyond "spelled many ways", 805 intake
  outcomes and 491 patient statuses match no known value at all.

The notes did warn about intakes referencing missing patients; there are 21 (I04).
They also warned that BSNs were never validated, and 17 fail the eleven-proef
checksum (P28).
