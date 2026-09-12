# Unresolved questions

Ambiguities. Things we could not decide, or that need someone else to answer.

Once answered, a question leaves here — the answer goes into `rough-drafts.md` or
`tech-stack.md`, along with whatever reasoning is worth keeping.

Agents append here. Agents never resolve anything here.

## 1.2.a What a declined proposal becomes
- Declining leaves the data unchanged, so on the next re-evaluation the rule
  finds the same problem and proposes the same fix again.
- Does declining mark the finding settled, or does it stay open and keep coming
  back?
- 1.4 says a row is promotable only once all its problems are resolved. If a
  decline does not settle anything, a declined row can never be promoted.
- Parked deliberately. We come back to it once the rules UI is settled.

## 1.1.c Re-evaluation and already-accepted changes
- 1.2.2 says all rules re-run against the modified data. 1.2.3 says accepted
  changes are final.
- Open: what stops a re-run from re-proposing a change over a value a rule
  already fixed and the user already accepted — does an accepted proposal
  suppress the finding that produced it, or does the rule have to recognise its
  own previous output as already-correct?

## 1.1.d Re-import versus accepted modifications
- The legacy import must be repeatable. Rules modify the raw data in place.
- Open: if the import runs a second time over rows that rules have already fixed
  and the user has already accepted, what protects those fixes from being
  overwritten by the original CSV values?

## 4.5.a Where the two apps are deployed
- §4.5 settles how the database gets to production — upload the SQLite file to
  Turso — but no host is chosen for the api or the web app.
- Deferred, not blocking. `.env.example` gains whatever the platform needs once a
  platform exists.
