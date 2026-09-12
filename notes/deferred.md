# Deferred

Things we deliberately left out, and what we would do instead given more time.
Cutting scope is fine; cutting it silently is not. Everything here goes in the
README as a stated choice.

## D1. Frontend unit tests
- Skipped entirely. No Vitest, no Testing Library, no Playwright on the web app.
- Why: the three things that must be provably correct — the eligibility engine,
  the state machine, and the import logic — are all backend. Test effort goes
  there.

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
