# Unresolved questions

Ambiguities. Things we could not decide, or that need someone else to answer.

Once answered, a question leaves here — the answer goes into `rough-drafts.md` or
`tech-stack.md`, along with whatever reasoning is worth keeping.

Agents append here. Agents never resolve anything here.

## 1.1.e How the runner finds and loads a rule
- The runner is whatever the "Apply rules" button calls: the thing that walks the
  active rule versions, executes each one against the data, and writes the
  resulting rows into `legacy_xxx_rule`.
- Rules are code keyed by `(ruleId, version)` (1.1.3). Open: how does the runner
  get from a database row saying `(R7, 2)` to the function that implements R7 v2
  — a registry file, a directory convention, decorators?
- Open: what interface does a rule implement? What is it handed, and what does it
  return? 1.1.4 says it reads and queries but never writes, and 1.1.10 says a
  finding is always field-shaped, which constrains the return type without
  fixing it.
- This is the next piece of backend work, so it blocks.

## 4.5.a Where the two apps are deployed
- §4.5 settles how the database gets to production — upload the SQLite file to
  Turso — but no host is chosen for the api or the web app.
- Deferred, not blocking. `.env.example` gains whatever the platform needs once a
  platform exists.
