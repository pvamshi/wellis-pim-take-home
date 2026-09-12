# Scaffold report

Run: `.claude/workflows/scaffold.js`, first run. Written 2026-09-12.

**Nothing was built.** The root unit did not clear its clarify phase, so it was
never implemented, and the orchestrator skips the two app units when root does
not pass rather than building on a base that does not exist. The repository is
byte-identical to what it was before the run, apart from this report and the
questions appended to `notes/unresolved-questions.md`.

---

## 1. What now exists

### Root (`.`) — not built

No file the root brief asked for is on disk. Verified by listing the working
tree, not by trusting the run log:

| Asked for | On disk |
|---|---|
| `package.json` with `"workspaces": ["apps/*"]` | absent |
| `apps/` directory | absent |
| `tsconfig.base.json` | absent |
| shared lint config | absent |
| shared format config | absent |
| `.gitignore` | absent |
| `.env.example` | absent |
| `justfile` | absent |
| `package-lock.json`, `node_modules/` | absent |

**Commands to run it:** there are none. Every command the brief names fails,
because the file it needs does not exist:

```
$ just --list
error: No justfile found

$ npm run build
npm error code ENOENT
npm error enoent Could not read package.json: Error: ENOENT: no such file or
  directory, open '/Users/vamshikrishna/code/vamshi/wellis-pim-take-home/package.json'
```

`npm install`, `just install`, `just dev`, `just build` and `just test` all fail
the same way for the same reason.

### Backend (`apps/api`) — not built, and not even clarified

The workflow builds root first and only fans out to the two apps if root passed.
Root did not, so the backend unit never ran: no clarify pass, no gap list of its
own, no directory. `apps/api` does not exist.

### Frontend (`apps/web`) — not built, and not even clarified

Same. `apps/web` does not exist.

This is worth stating plainly because it changes what the next run has to do:
the backend and frontend units are **unexamined**, not **examined and blocked**.
Their requirements may hold more gaps that nobody has looked for yet. The two
questions below are the ones root found; they are not the whole set.

### What was already here and is untouched

`ASSIGNMENT.md`, `README.md`, `legacy_export/` (4 files) and `notes/` (the same
five files as before this run, now six with this report) are unmodified. The run
wrote no product code anywhere.

---

## 2. Units not built, and the exact gaps

### Root — 2 gaps

The clarify agent turned the root brief into 19 checkable requirements and found
17 of them buildable as written. Two were not, and both are the kind that spread
into the units downstream rather than staying put.

**Gap 1 — no linter or formatter has ever been chosen.**
The brief asks for "shared lint and format config" at the root. `tech-stack.md`
names React, Vite, Mantine, NestJS, TypeORM, SQLite/Turso and Vitest, and says
nothing about linting or formatting. `unresolved-questions.md` did not list it
either. The two realistic forks produce different root files, different root
devDependencies, and opposite instructions to the app units:

- ESLint flat config plus Prettier — which is also what the Nest CLI and
  `npm create vite` generate, so the root config would mean hoisting and
  de-duplicating what the apps produce, keeping their generated setup.
- One all-in-one tool such as Biome — which would mean deleting the generated
  lint configs in both apps outright.

The backend brief calls out exactly one deviation from Nest CLI defaults (rip
out Jest, use Vitest) and is silent on lint, which hints at keeping the
defaults. A hint is not a decision, and the clarify agent declined to promote it
to one.

*Blocks:* the shared lint config, the shared format config, the root
devDependencies backing them, and the instruction each app unit needs about
whether to keep or delete its CLI-generated lint setup. Nothing else in root.

**Gap 2 — `.env.example` has no variable names to document.**
`.env.example` is the whole point of the root unit for the two app units: it is
the contract they are built against, in parallel, by separate agents.
`tech-stack.md` §4.6 says local is a file with "separate files for test, dev and
production-shaped runs", that deployment points at Turso with an auth token, and
that all of it sits behind one config module. That leaves unnamed:

- The variable names themselves — one `DATABASE_URL`, or `SQLITE_PATH` alongside
  `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`?
- Whether the three local files are three separate variables, or one variable
  whose value differs across `.env`, `.env.test` and so on.
- What makes the config module choose Turso over a file: the presence of a Turso
  URL, an explicit mode variable, or `NODE_ENV`.
- The two non-database variables: what the backend's listen port variable is
  called, what the frontend's API base URL variable is called (it must carry
  Vite's mandatory `VITE_` prefix or Vite will not expose it to client code),
  and what both default to.
- Related and also open: §4.5 says the SQLite file is uploaded to Turso
  directly, but no host has been chosen for either app, so "every environment
  variable the stack needs" cannot yet include whatever the deploy platform
  requires.

*Blocks:* all of `.env.example`. Guessing here does not stay in root — the api
and web units each invent their own names and the two halves do not talk. That
is the failure mode the assignment calls "plausible-looking wrong systems".

### Backend, frontend — blocked upstream, not on their own merits

Not clarified. See above.

---

## 3. TODOs left behind

No code was written, so there are no `TODO` comments in any source file. What
exists instead is a set of deferred obligations, each waiting on a named
decision:

| Deferred item | Waits on |
|---|---|
| Shared lint + format config at root | Gap 1 — pick a linter and formatter |
| Root devDependencies beyond `typescript` | Gap 1 |
| Each app's generated lint config: keep or delete | Gap 1 |
| `.env.example`, in full | Gap 2 — name the variables |
| The api config module's file-vs-Turso selection rule | Gap 2 |
| The `VITE_`-prefixed API base URL name, shared by both apps | Gap 2 |
| Deploy-platform variables in `.env.example` | No host chosen for either app |
| `just dev` actually starting both servers | The api and web units existing. Even once written, this recipe cannot be exercised at root-unit time; the clarify agent recorded it as a deferred check, not a pass |
| A router for the frontend | `unresolved-questions.md` §4.1.a, already open. The frontend brief says leave a TODO naming it — that TODO was never written, because the unit never ran |
| Whether `.claude/` is tracked | Nobody has decided. See §4.8.a in the questions file |

The contract that both apps extend `tsconfig.base.json` by reference
(`"extends": "../../tsconfig.base.json"`) rather than copying it is recorded but
unverifiable until the apps exist. So is the rule that `tsconfig.base.json` must
not set `jsx`, `module`, `moduleResolution`, `outDir`, `rootDir`,
`experimentalDecorators` or `emitDecoratorMetadata` — the two apps need
conflicting values for those, so each owns them.

---

## 4. Unmet, overreaching, or failing

**Unmet:** the entire root brief, and both app briefs. Errors are in §1 — they
are all ENOENT on a file that was never created, not a build that broke.

**Overreaching:** nothing. No unit wrote product code, no unit invented a
decision. The clarify agent explicitly refused to promote two hints to
decisions, which is the behaviour `rough-drafts.md` §5.1 asks for.

**Still failing, and not a gap:**

- **Node 25.2.1 on this machine.** `better-sqlite3` and `libsql` — the pair
  §4.6 depends on — publish prebuilt binaries for a lagging window of Node
  major versions, and 25 is ahead of it. This will surface as a node-gyp
  compile during `npm install` in the backend unit, or as an install failure.
  It is a backend problem, not a root decision, but it is real and it is
  waiting. Nobody has pinned a Node version for this project (no `.nvmrc`, no
  `engines` field — there is no `package.json` to hold one).
- **`.memcli/` is excluded by `~/.gitignore`, not by anything in this repo.**
  A fresh clone on another machine has no such exclusion. If the root
  `.gitignore` is written to the requirement list as it currently stands, it
  does not cover `.memcli/`, and that directory (SQLite databases, WAL sidecars,
  a vector index) becomes untracked-and-visible there. The `*.db` / `-wal` /
  `-shm` patterns the list does specify would in fact catch most of it — but by
  accident, not by intent.
- **`.claude/` is untracked and ignored by nothing.** It holds
  `workflows/scaffold.js`, which `rough-drafts.md` §5 treats as part of the
  project. The requirement list enumerates what `.gitignore` must and must not
  ignore and does not mention `.claude/` in either direction. Someone has to
  decide.

---

## 5. What the next run needs

Answer the two root gaps, then re-run. Root is otherwise fully specified: 17 of
its 19 requirements are buildable today, expressed as assertions that can be
checked rather than prose. Once root passes, the backend and frontend units get
their first clarify pass, and they may well come back with gaps of their own —
budget for that rather than assuming the scaffold completes on the second run.
