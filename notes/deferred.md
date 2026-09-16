# Deferred

Things we deliberately left out, and what we would do instead given more time.
Cutting scope is fine; cutting it silently is not. Everything here goes in the
README as a stated choice.

## D1. Frontend unit tests
- Skipped entirely. No Vitest, no Testing Library, no Playwright on the web app.
- Why: the three things that must be provably correct — the eligibility engine,
  the state machine, and the import logic — are all backend. Test effort goes
  there.

## D5. Retiring a duplicate row — resolved by 1.7.5
- Unblocked by the stored row rejection of 1.6.6: confirming a patient link
  rejects X.

## D4. Re-importing, as a feature
- The importer ignores any id already in the database. That is the whole of it.
- Cut entirely: update-or-merge semantics, a conflict queue for an id whose
  values disagree, any report of what was skipped and why, and any way to take a
  correction from a re-exported file.
- Why: it is a feature in its own right and not where the value of this project
  is. The import runs once against a fixed export; building re-import machinery
  now spends the time in the wrong place.
- What it costs: the only way to take a correction from the source is to clear
  the table and import again. And a run that skips every row looks, from the
  outside, like a run that imported nothing to do.

## D3. Rules interacting with each other
- We do not handle the case where one rule's accepted fix causes another rule to
  flag the same data as a problem.
- Why: it is not expected to come up, and building for it now costs ordering,
  pass structure, or both. Get something basic working first.
- If it does happen, we address it then.

## D6. Fixes that change two columns at once (1.1.4) — withdrawn
- Deferred on 2026-09-15, with kilograms assumed for an empty weight unit.
- Withdrawn on 2026-09-16: an empty unit is not always kilograms, and a pounds
  weight needs converting rather than correcting by hand. Row-level approve and
  decline now act on every column a version proposes for that row, and P66
  converts a pounds weight. Still not built: showing those columns on screen as
  one change rather than as separate lines.

## D7. Rewriting a rule without a person starting it
- Guidance typed on a rule parks its active version and files the reason. The
  next version is written by an agent running the revision workflow, and that
  workflow is started by hand. Nothing watches the queue, and no rule rewrites
  itself.
- Why: a rule is code, and an active one changes patient data. An agent that
  wrote and activated a version unattended would put changes into the data with
  nobody having read the rule that made them. The queue is what keeps a person
  between the guidance and the code.
- What it costs: the loop is not closed end to end. Guidance waits in
  `needsReview` until someone runs the workflow, so a parked rule — its rows
  visible and undecided — stays parked for as long as nobody looks.

## D2. Reversing an accepted modification
- Once the user accepts a proposal, the change is final. There is no undo, and no
  replay of a rule's earlier version over data it already changed.
- Why: supporting it means moving modifications forward and backward, which means
  the current row becomes a derivation rather than a stored value. Too much
  complexity for the value at this stage.
- What it costs: when a rule goes to a new version, rows the old version already
  fixed keep the old version's decision. The modification log still says which
  version made each change, so the history stays honest — the data is just not
  retroactively re-derived.
