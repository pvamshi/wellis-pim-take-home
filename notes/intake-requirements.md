# Intake requirements — discussion

Part B, new patient intake. A working space: nothing here is final until it is
moved into `final-requirements.md` under the same address.

Addresses start at 2 because Part A is 1. Numbers are addresses, not order.

Where a node says **the doc**, it means `ASSIGNMENT.md`, quoted as written.

---

## 2.1 The final table

Plan its columns and their types.

- Legacy rows that clear the rows screen are accepted into it (2.6), so it is
  the table 1.4 deferred — promotion now has a target.

**Open:** whether a submitted intake writes a patient into this same table. The
doc's patient detail view shows "current record, their intakes", which reads as
one table for both.

## 2.2 Statuses

The statuses the doc gives an intake.

The doc: `draft → submitted → (auto_cleared | auto_flagged | auto_rejected) →
in_review → (approved | rejected)`. "Illegal transitions must be impossible, not
just avoided."

## 2.3 The intake form

Multi-step, moving through the statuses in 2.2.

The doc, "at minimum": identity (name, email, date of birth), body metrics
(height, weight), current medications, relevant conditions, and consent.

## 2.4 The review view

For the intakes that need review.

The doc: "the submission, the rule evaluation with explanations, and
approve/reject with a required note."

## 2.5 Form validation

The form accepts values only in the correct format, checked in the frontend.

## 2.6 Accepting an import row into the final table

When a row is accepted from its import status into the final table (2.1) and
its data is not valid:

- the error is caught
- the user is shown the error
- nothing in the database changes

---

## Open questions

- **2.a** Is the eligibility engine the Part A rules engine, or a separate one?
  Both are versioned and explain themselves, but a Part A rule proposes a change
  and waits for a human, while an eligibility ruleset classifies a submission on
  the spot and the intake records which ruleset judged it.
- **2.b** The doc also requires a deterministic eligibility rules engine (its
  six-row rules table) and an audit log of every state change and human decision.
  Neither is a node yet.
