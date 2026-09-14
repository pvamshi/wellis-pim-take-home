# Wellis take-home — Patient Intake & Legacy Migration

Take-home assignment for the Senior Engineer role on the Patient Information
Management team at Wellis.

Start with [ASSIGNMENT.md](ASSIGNMENT.md). The dataset you'll be working with is in
[`legacy_export/`](legacy_export/), described in
[`legacy_export/EXPORT-NOTES.md`](legacy_export/EXPORT-NOTES.md).

All patient data in this repository is synthetic. No real person appears in it.

## Running it

Needs Node 22 (see `.nvmrc`) and [`just`](https://github.com/casey/just).

```sh
nvm use
just install
cp .env.example .env
```

Then load the legacy export and register the rules:

```sh
just import
just rules-sync
```

`just import` creates `data/dev.sqlite`, creates the schema in it, and reads
`legacy_export/` into the legacy tables. There is no migration step — the schema
has one final state, so TypeORM builds it on connect. Re-running the import
skips ids that are already there, so it is safe to repeat.

`just rules-sync` reconciles the rule catalogue in code into the `rule` and
`rule_version` tables. It reads code and writes the database, never the other
way round, and it is idempotent — run it after adding a rule, and again after an
interrupted run.

```sh
just dev
```

The API listens on the `PORT` in `.env` (3000 by default) and the web app on
<http://localhost:5173>. If something else on your machine already holds 3000,
change `PORT` and `VITE_API_BASE_URL` together — the frontend reads the second
to find the first.

### The rest of the commands

| | |
|---|---|
| `just test` | the backend test suite (Vitest). The web app has no tests, by decision |
| `just build` | build both workspaces |
| `just lint` / `just format` | ESLint and Prettier across the repository |
| `just import <dir>` | import an export other than `legacy_export/` |
| `just revise queue` | every rule version waiting to be revised |
| `just revise apply <file.json>` | apply one revision |

A bare `just` lists them.

### Pointing at Turso

Set `DATABASE_URL` to the `libsql://` URL and add `TURSO_AUTH_TOKEN`. Nothing
else changes: the scheme of that one variable selects the driver, so there is no
environment flag and no second set of connection settings.
