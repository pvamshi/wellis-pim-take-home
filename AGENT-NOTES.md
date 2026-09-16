# Agent notes

Built with Claude Code. Session traces are the exported transcripts in
[`traces/`](traces/) — `1.txt` to `4.txt`, one per session, in the order they
happened — and the raw session logs submitted with them.

## How I decomposed the work

**Spec before code.** Every part started as a discussion filed in `notes/`: rough
drafts first, then `final-requirements.md` (Part A, written as Gherkin scenarios) and
`intake-requirements.md` (Part B). `tech-stack.md` held every stack decision, and
`deferred.md` held every scope cut. Agents read those files as the contract, and were
told never to decide anything listed as open.

**Workflows, not one long chat.** Builds ran as scripted multi-agent workflows in
`.claude/workflows/`:

- `scaffold` for the monorepo;
- `build` for the Part A engine;
- `rules` for the 130-rule catalogue;
- `duplicates`, `rows` and `intake` for features;
- `revise`, which writes a new rule version from reviewer feedback;
- `rule-effects`, which measures a changed rule, judges it, and has a second agent
  challenge the verdict.

Each unit went develop → independent review → commit. Only work that passed review
was committed, one commit per unit, pushed.

**Batches.** Early workflows ran one develop/review cycle per task. The duplicates
build took about 1.5 hours and 20 agents for five tasks, because every agent re-read
the codebase and re-ran the full suite. From then on, tasks were batched along layer
seams: rules six at a time, features in about three batches.

## Where I let it run, and where I took the wheel

The agents ran scaffolding, per-rule implementation and tests, and feature batches
against a settled spec.

I took the wheel on:

- **Schema.** Raw data preserved beside working columns. A finding table keyed by
  `(legacy id, rule, version, column)`, so a decline can outlive a version.
- **Merge semantics.** Duplicates are links, confirmed by a person, and never merged
  automatically.
- **Decline semantics.** Declining a row is permanent; declining a rule parks the
  version for revision.
- **State modelling.** Transitions enforced by database triggers, not only by the
  service.
- **Eligibility edge cases.** A missing answer flags and never clears. A missing BMI
  or revoked consent rejects. A pending duplicate blocks import.

## Where I rejected or corrected its output

- **It guessed a unit, and I made it undo the guess.** Asked to make kilograms the
  default, the agent wrote P47 v2 to propose `kg` for every blank unit and approved
  the 18 open findings. I pushed back that blank units and pounds weren't being
  handled. The 18 weights were 140–320: BMIs of 57 to 93 read as kilograms, 26
  to 42 read as pounds, so the acceptances were almost certainly wrong. It reverted them, sent P47 v2 back for revision with that
  reason, built two-column fixes, and wrote P66 to convert pounds weights with the
  unit in the same approval. A blank unit now fails import instead of passing as kg.
- **It read the data unprompted.** Early on it started reading the legacy files
  on its own initiative, and I stopped it. Later I had the rule catalogue written
  from `EXPORT-NOTES.md` and ordinary assumptions, without profiling the data, so
  rules would not be fitted to the rows it happened to see.
- **Its clarify agent blocked instead of deciding.** The first scaffold run refused
  to build over two open questions. I changed the contract so it decides with sane
  defaults.
- **It added scope that traced to nothing.** Its task list had a rule-catalogue
  phase no requirement asked for. I removed it: that build was infrastructure only,
  tested with fake rules.
- **It shipped a button that could only fail.** Ambiguous rows had an approve tick,
  but an ambiguous rule proposes no value, so every approval errored. I had the rows
  redesigned into a value box with its own decline.
- **It re-invented a standard control.** Asked for bulk import, it built a custom
  select-all toolbar that showed on every tab. I rejected it: a checkbox before each
  row and a header Select all, only where import is possible.
- **Its reviewer halted good work.** A build run stopped on "overreach" with zero
  unmet requirements. The halt condition was wrong, not the code, and I fixed the
  workflow.

## What I'd do differently

- **Settle data-shape questions before deferring them.** Pounds and two-column fixes
  were deferred, then built anyway, after bad accepts had to be undone. A small,
  explicit profiling pass, separate from rule writing, would have surfaced it without
  skewing the rules.
- **Batch workflow tasks from the first build**, not after the duplicates run showed
  the cost.
- **Design Part C's combined queue alongside Parts A and B.** It was left until
  last, and the per-source screens now need joining.
- **Keep a smoke test on the web app.** Several UI regressions reached the browser
  that a thin end-to-end check would have caught.
