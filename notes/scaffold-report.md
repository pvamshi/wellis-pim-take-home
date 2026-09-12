# Scaffold report

Run: `.claude/workflows/scaffold.js`, third run. Written 2026-09-12.
Supersedes the second-run report that previously occupied this file.

**All three units were built.** Root cleared clarify with zero gaps and was
implemented, reviewed and committed (`469cb87`). The api and web units then ran
in parallel, both cleared clarify with zero gaps, and both were implemented.
`apps/api` and `apps/web` are on disk and untracked at the time of writing.

One thing does not work: the api cannot be built or started, because the Nest
CLI picks up a TypeScript the root did not choose. The fix is a one-line change
to the root `package.json` that no unit was allowed to make. Section 4 has the
error text.

Everything in this report was re-checked against the working tree. Where a unit
agent's summary disagrees with the disk, section 5 says so and the disk wins.

---

## 0. What changed since the second run

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Units clarified | 1 of 3 | 1 of 3 | 3 of 3 |
| Gaps blocking a unit | 2 | 1 | 0 |
| Units built | 0 | 0 | 3 |
| Checkable requirements restated | 19 | 32 | 43 + 43 + 44 = 130 |
| Commits | none | none | 1 (`469cb87`, root) |

The three questions that blocked earlier runs were all answered in
`tech-stack.md` before this run, which is why clarify came back clean:

- §4.10 — the shared TypeScript config. The base is the real config; it fixes
  seven strictness options; each app's generated tsconfig is trimmed to
  `extends` plus what that app must own.
- §4.11 — top-level commands. `concurrently` is allowed as a root
  devDependency, so `just dev` starts both apps side by side.
- §4.1 — the router. `react-router-dom`, plain nested routes. The stale
  frontend brief in `.claude/workflows/scaffold.js` was corrected to match, so
  the frontend clarify agent found agreement rather than a contradiction.

---

## 1. What now exists

### Prerequisites, both of which bite

**Node 22.** `.nvmrc` says `22` and the root `engines` says `>=22.0.0 <23.0.0`.
This machine's default is still v25.2.1. Node 22.23.2 was installed through the
existing nvm during the backend unit, and `nvm use` does not take effect in this
machine's non-interactive shells, so the reliable form is:

```
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
```

Everything in this report was run that way. On Node 25 the install still
completes — npm prints an advisory `EBADENGINE` warning — but `better-sqlite3`
and `libsql` have no prebuilt binary there and compile from source or fail.

**A `.env`.** The api has no default `DATABASE_URL` by design and throws a named
error without one. Before booting anything:

```
cp .env.example .env
```

### Root (`.`) — built, reviewed, committed as `469cb87`

Eleven paths, exactly as briefed, nothing else:

| Path | What it is |
|---|---|
| `package.json` | private, `0.0.0`, `workspaces: ["apps/*"]`, `engines` Node 22, eight devDependencies, no `type`, no `scripts` |
| `package-lock.json` | lockfileVersion 3, tracked |
| `.nvmrc` | `22` |
| `apps/.gitkeep` | empty, so git tracked the directory before the apps existed |
| `tsconfig.base.json` | one `compilerOptions` object, the seven strictness keys, nothing else |
| `eslint.config.mjs` | ignores, `js.configs.recommended`, typescript-eslint `recommended`, `eslint-config-prettier` last |
| `.prettierrc.json` | `singleQuote`, `trailingComma: all`, `printWidth: 100` |
| `.prettierignore` | includes `legacy_export`, `notes`, `README.md`, `ASSIGNMENT.md`, `.claude` |
| `.gitignore` | build output, `.env*` with a `!.env.example` negation, SQLite files, `data/`, `.memcli/` |
| `.env.example` | the four variables from §4.6.1, both `DATABASE_URL` shapes, no credential values |
| `justfile` | seven recipes |

The justfile is the only top-level command surface — the root `package.json`
deliberately has no `scripts` block.

```
just                # or `just --list`; prints the seven recipes
just install        # npm install at the root, installs every workspace
just lint           # npx eslint .            -> exit 0
just format         # npx prettier --write .  -> exit 0, changes nothing
just test           # every workspace with a test script -> exit 0
just build          # every workspace with a build script -> exit 1 today, see §4
just dev            # api and web side by side through concurrently
```

Verified again for this report, on Node 22: `just test` exits 0, `just build`
exits 1 (web builds, api fails), `npx eslint .` exits 0, `npx prettier --check .`
exits 0.

### Backend (`apps/api`) — built, not committed

Fifteen files. No Jest wiring, no Terminus, no Prisma, no migration tooling, no
entities, no product behaviour.

```
apps/api/package.json          apps/api/tsconfig.json
apps/api/tsconfig.build.json   apps/api/nest-cli.json
apps/api/eslint.config.mjs     apps/api/vitest.config.ts
apps/api/src/main.ts
apps/api/src/app.module.ts
apps/api/src/config/database-url.ts
apps/api/src/config/app-config.module.ts
apps/api/src/health/health.module.ts
apps/api/src/health/health.controller.ts
apps/api/test/temp-database.ts
apps/api/test/health.spec.ts
apps/api/test/database-url.spec.ts
```

What it does. `GET /health` — no global prefix, CORS on, port from `PORT`
defaulting to 3000 — injects the TypeORM `DataSource`, runs `SELECT 1`, and
answers `200 {"status":"ok","database":"up"}` or, when the probe throws,
`503 {"status":"error","database":"down"}`. That path, port and body are the
contract the frontend was built against, and they match.

One module owns the database. `buildDataSourceOptions` in
`src/config/database-url.ts` is a pure function over `{ DATABASE_URL,
TURSO_AUTH_TOKEN }`: `file:` yields `better-sqlite3` against an absolute path
with no driver override, `libsql://` yields the same driver type with the
`libsql` package handed in, subclassed so `TURSO_AUTH_TOKEN` reaches its
constructor. The scheme alone decides. The `file:` path is stripped textually,
never through `new URL()` — `new URL('file:./data/dev.sqlite')` normalises to
`file:///data/dev.sqlite`, which would point the app at the filesystem root.
Missing `DATABASE_URL`, an unknown scheme, and `libsql://` without a token each
throw an error naming the variable. `AppConfigModule` creates the parent
directory of a `file:` database before better-sqlite3 opens it, and loads
`.env` from both `apps/api` and the repository root.

```
npm run test  -w apps/api    # vitest run -> 2 files, 7 tests, exits 0, terminates
npm run lint  -w apps/api    # exit 0
npm run build -w apps/api    # nest build          -> exit 1 today, see §4
npm run dev   -w apps/api    # nest start --watch  -> exit 1 today, see §4
npm run start -w apps/api    # node dist/main.js; needs a successful build first
```

The suite uses no mocks. It boots the whole `AppModule` against a fresh SQLite
file under `mkdtemp` in the OS temp directory, probes `/health` through
supertest after `app.init()` (never `app.listen()`, so it cannot collide with a
running dev server), and asserts the file exists on disk. The second spec covers
all three `DATABASE_URL` branches, including the libsql wiring, which cannot be
exercised against a real Turso database at scaffold time.

### Frontend (`apps/web`) — built, not committed

Thirteen files. No tests anywhere, by design (§4.7 and deferred D1) — the web
workspace has no `test` script, which is why `just test` needs `--if-present`.
No CSS of our own, no PostCSS, no data grid, no Mantine package beyond core and
hooks, no data-fetching or state library, no Vite demo content, no app-level
README, `.gitignore`, `.env` or Prettier config.

```
apps/web/package.json      apps/web/index.html        apps/web/vite.config.ts
apps/web/tsconfig.json     apps/web/tsconfig.app.json apps/web/tsconfig.node.json
apps/web/eslint.config.mjs
apps/web/src/main.tsx      apps/web/src/App.tsx       apps/web/src/vite-env.d.ts
apps/web/src/api/client.ts apps/web/src/api/types.ts
apps/web/src/pages/HealthPage.tsx
```

One page. It calls the backend's health endpoint once on mount through
`src/api/client.ts`, which is the only module that reads `VITE_API_BASE_URL`
(default `http://localhost:3000`, trailing slash stripped) or calls `fetch`. The
page renders three states — loading, reachable, failed — and shows the resolved
base URL in all three, so a misconfigured variable is visible on the page. The
reachable state prints the whole response body, not just one field, because the
backend was being built in parallel. A Retry button re-runs the request without
a reload.

`vite.config.ts` sets `envDir` to the repository root, so the single root `.env`
actually reaches the app; without it Vite would read only `apps/web/.env` and the
documented variable would be silently ignored. There is no dev proxy — the app
calls the absolute base URL, which is what makes the variable meaningful, and
which is why the api enables CORS.

```
npm run dev     -w apps/web   # vite, port 5173 (moves to 5174 if taken)
npm run build   -w apps/web   # tsc -b && vite build -> exit 0
npm run preview -w apps/web
npm run lint    -w apps/web   # exit 0
```

Re-verified for this report: `npm run build -w apps/web` exits 0 and emits
`dist/index.html` plus hashed JS and CSS (234 kB CSS, 323 kB JS). The build
type-checks as well as bundles, so `just build` catches frontend type errors.

### What was already here and is untouched

`README.md`, `ASSIGNMENT.md` and `legacy_export/` are byte-identical.
`notes/final-requirements.md` was not touched by any unit or by this report.

---

## 2. Units not built, and the exact gaps

**None. There are no gaps this run.**

All three clarify agents returned `clear: true` with an empty gap list, and all
three units were implemented. This is the first run where that is true, and it
is worth being precise about why it is not luck: every gap the earlier runs
raised had been answered in `tech-stack.md` — the file agents actually read —
before this run started, rather than left sitting in the questions file.

Three entries in `notes/unresolved-questions.md` are now stale bookkeeping
rather than open decisions, and each clarify agent said so independently:

| Question | Answered by | Status |
|---|---|---|
| §4.10.a — what the shared tsconfig fixes | `tech-stack.md` §4.10 | answered; entry stale |
| §4.11.a — how `just dev` starts both apps | `tech-stack.md` §4.11 | answered; entry stale |
| §4.1.b — does the frontend install a router | `tech-stack.md` §4.1, plus the corrected brief in `scaffold.js` | answered; entry stale |

They survive because that file's own rule is that agents append and never
resolve. Retiring them is a human edit.

Still genuinely open and still not blocking: §4.5.a, where the two apps are
deployed. It only affects `.env.example`, which stays at its four variables.

---

## 3. TODOs left behind

Four, each parked against a named decision. Two are comments in files on disk;
two are entries in a unit's todo list with no code to hang a comment on.

| TODO | Where | Waits on |
|---|---|---|
| Which TypeScript the repository pins, and therefore whether `apps/api` keeps `module: commonjs` | comment at the top of `apps/api/tsconfig.json` | A root `package.json` decision. This is the one blocking item — §4 |
| Who lints and formats `.claude/workflows/*.js` | comment inside the `ignores` array of `eslint.config.mjs` | A decision about the workflow scripts. `.claude` is currently excluded from both ESLint and Prettier |
| Whether to opt into Vite's strict `import.meta.env` typing | comment block in `apps/web/src/vite-env.d.ts` | Whoever owns frontend requirement 17 — §4 |
| Where `@types/node` is declared | frontend unit todo; no file to mark | `apps/web` needs it for `tsconfig.node.json`'s `types: ["node"]` and for `vite.config.ts`'s `node:url` import, but its dependency list is fixed at seven packages that do not include it. It resolves today only because `apps/api` declares it and npm hoists it to the root |

Deferred rather than forgotten, and not a TODO in code: deploy-platform
variables in `.env.example`, waiting on §4.5.a.

---

## 4. Unmet, overreaching, or still failing

### Blocking: the api will not build or start

`npm run build -w apps/api` and `npm run dev -w apps/api` both exit 1. Run
again just now, on Node 22.23.2:

```
> api@0.0.0 build
> nest build

 Error  The installed TypeScript version (7.0.2) does not expose the
 programmatic compiler API that the Nest CLI requires. TypeScript 7.0 ships the
 "tsc" executable only; the compiler API is expected to return in 7.1. Please
 install TypeScript 6 (e.g. "npm i -D typescript@^6") until then.
```

`nest start --watch` fails with the same message. `just build` therefore exits
1 overall — it builds `apps/web` successfully and fails on `apps/api`.

The cause, confirmed on disk rather than inferred:

- `apps/api/node_modules/@nestjs/schematics/package.json` declares
  `"typescript": ">=6.0.0"` as a peer dependency.
- The root `package.json` pins `"typescript": "^5"`, resolved at 5.9.3 in the
  root `node_modules`.
- npm satisfies the peer by nesting a second copy: `apps/api/node_modules/typescript`
  is 7.0.2.
- The Nest CLI resolves TypeScript from the project directory, so it finds
  7.0.2 and refuses it.

Unmet requirements, both in the backend unit: **req 14** (`npm run build -w apps/api`
exits 0 and produces `dist/main.js`) and **req 41** (`npm run dev -w apps/api`
boots and `/health` answers 200). The behaviour behind req 41 is proven — the
reviewer moved the nested TypeScript aside, built, booted, and got
`200 {"status":"ok","database":"up"}` with the CORS header present, `/api/health`
a 404, and the missing `data/` directory created — but it does not hold on a
fresh install.

No unit could fix it. Adding `typescript` to `apps/api` is forbidden by backend
req 6, an `.npmrc` by req 9, `@swc/cli` would break the exact dependency list in
req 5, and npm honours `overrides` only in the root `package.json`, which the
backend unit was required to leave byte-identical. The two candidates:

- Add `"overrides": { "typescript": "$typescript" }` to the root `package.json`.
  Verified working by the backend implementer and again by its reviewer; keeps
  `apps/api/tsconfig.json` exactly as it is.
- Move the repository to TypeScript 6. Then `apps/api` cannot keep
  `module: commonjs` with `moduleResolution: node10`, so it becomes
  `nodenext`/`nodenext` — still emitting CommonJS, since `apps/api/package.json`
  has no `"type": "module"` — which contradicts backend req 11 as written.

### Unmet: the frontend's typed env variable does not catch a typo

Frontend **req 17**. `apps/web/src/vite-env.d.ts` has exactly the contents the
requirement specifies and `VITE_API_BASE_URL` does type as `string | undefined`,
but the requirement's stated purpose — a typo in the variable name fails
`tsc -b` — does not hold. Confirmed in `node_modules/vite/types/importMeta.d.ts`:

```ts
type ImportMetaEnvFallbackKey =
  'strictImportMetaEnv' extends keyof ViteTypeOptions ? never : string

interface ImportMetaEnv extends Record<ImportMetaEnvFallbackKey, any> {
```

Unless some module declares `interface ViteTypeOptions { strictImportMetaEnv:
unknown }`, every unknown key resolves to `any` and compiles. The requirement
does not mention that opt-in. The implementer wrote an accurate TODO instead of
adding it, and the reviewer verified the failure with a deliberately misspelled
probe. One line to fix if req 17 means what it says; otherwise req 17's
justification needs amending.

### Overreach: one, and it was forced

Root `eslint.config.mjs` carries an eighth entry in its global `ignores` —
`.claude` — beyond the seven the root brief named. Without it `npx eslint .`
exits 2 with 11 `no-undef` errors on `.claude/workflows/scaffold.js`, because
the workflow runner injects `agent`, `log`, `phase` and `pipeline`. Root req 1
forbade editing that script and req 20 forbade adding environment globals to the
root config, so there was no compliant alternative to `just lint` exiting 0.
The matching `.claude` line in `.prettierignore` is not overreach — that
requirement was an "at minimum" list. Do not remove either without first
deciding who owns linting the workflow scripts.

Nothing else. No unit wrote product code, invented a table, or added a package
its brief did not name.

### Not failing, but fragile: how TypeORM finds `better-sqlite3`

`better-sqlite3` exists once, at 13.0.3, under `apps/api/node_modules`. TypeORM
lives in the root `node_modules` and declares `better-sqlite3: ^12.0.0` as an
optional peer, so ordinary resolution from TypeORM's own location does not find
it at all:

```
$ node -e "require.resolve('better-sqlite3')"     # from the repository root
NOT RESOLVABLE (MODULE_NOT_FOUND)
$ cd apps/api && node -e "require.resolve('better-sqlite3')"
.../apps/api/node_modules/better-sqlite3/lib/index.js
```

It works because TypeORM's `PlatformTools.load` falls back to
`require(process.cwd() + '/node_modules/' + name)`. Every supported command runs
with the working directory at `apps/api`, so the fallback lands. Running
`node apps/api/dist/main.js` from the repository root would not. Worth a
decision, not a fix right now.

### Environmental, and not defects

- **Node 22 is not this machine's default.** `node -v` is v25.2.1; nvm has
  22.23.2 and 24.11.0. Every command in this report was run with 22.23.2 on the
  PATH. On the default, `npm install` warns `EBADENGINE` and completes.
- **Vitest prints a config warning.** `vitest.config.ts` uses ESM syntax in a
  file loaded as CommonJS. The run exits 0; silencing it needs a `.mts`
  extension or `"type": "module"`, both ruled out by the backend requirements.
- **Port 5173 was occupied** by an unrelated Vite server of yours during the
  frontend unit, so the dev server announced the clash and moved to 5174. The
  config sets no port. Something unrelated also listens on 3000 (a Next.js app),
  which is why the frontend's first health check failed on CORS rather than
  connection refused — worth knowing before reading a red Alert as a bug in the
  api.
- **`apps/web/dist/` is on disk** from the verification builds. It is covered by
  the root `.gitignore` (`dist/`) and is not tracked.

---

## 5. Where the unit summaries and the disk disagree

Three places. The disk is what this section reports.

1. **The backend implementer's second todo is wrong.** It reports a
   `better-sqlite3` version split — 12.11.1 at the root for TypeORM, 13.0.3
   nested under `apps/api` — and asks for a decision between them. There is no
   split. There is exactly one copy on disk, 13.0.3, at
   `apps/api/node_modules/better-sqlite3`, and no 12.x anywhere in the tree. Its
   reviewer caught this too. The real issue is the resolution path described in
   §4, not a duplicate install.

2. **The root unit's summary says `just dev`, `just build` and `just test` fail
   with `npm error No workspaces found!`.** That was true when `apps/` held only
   `.gitkeep`. It is not true now: `just test` exits 0 with the api suite
   included, and `just build` fails on the api's TypeScript error while building
   the web app successfully. The root review's "apps/ again holds only .gitkeep"
   is stale for the same reason — the two app units ran after it.

3. **This file itself was stale until now.** `469cb87` committed the root
   scaffold but left this report saying nothing had been built. That is what
   this rewrite fixes. Five files under `notes/` and
   `.claude/workflows/scaffold.js` were modified by earlier phases of this run
   and left uncommitted by that commit, deliberately, as belonging to the
   previous step.

Checked and in agreement with the disk: the eleven root paths and their
contents, the fifteen api files, the thirteen web files, the absence of any Jest
residue under `apps/api`, the absence of a lockfile or `node_modules` commitment
inside either app, the seven-key `tsconfig.base.json`, both apps extending it by
reference without copying it, both apps importing the root ESLint config by
relative path, and `README.md` / `ASSIGNMENT.md` / `legacy_export/` untouched.

---

## 6. What comes next

1. **Decide the TypeScript pin.** It is the only thing standing between this
   scaffold and a working `just build`. Appended as §4.10.b in the questions
   file. The `overrides` route is verified working and changes nothing else.
2. Decide who lints and formats `.claude/workflows/*.js` (§4.9.a), where
   `@types/node` is declared (§4.2.a), and whether to opt into strict
   `import.meta.env` typing (§4.1.c).
3. Commit `apps/api` and `apps/web`, along with the notes and workflow-script
   edits `469cb87` left behind.
4. Retire the three stale entries in `notes/unresolved-questions.md` — §4.10.a,
   §4.11.a and §4.1.b. Agents cannot; a human can.
5. `nvm install 22 && nvm use 22`, or the PATH form above, before any further
   install. The pin is load-bearing now that `better-sqlite3` and `libsql` are
   in the tree.

After that the scaffold is done and the next run is product work: the import,
the rules engine, and the entities none of these three units were allowed to
invent.
