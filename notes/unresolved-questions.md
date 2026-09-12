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

## 4.10.a What the shared TypeScript config fixes, and how strict it is
- Raised by the root clarify agent, scaffold run 2. It is the only thing blocking
  the root unit.
- §4.9 settles this for linting — the CLI-generated ESLint setups get hoisted and
  de-duplicated into one shared root config. Nothing says anything comparable for
  TypeScript, and no strictness level is named anywhere in the notes.
- Open: is `tsconfig.base.json` the real config, with each app's generated
  tsconfig trimmed down to app-specific overrides? Or does each app keep what its
  generator produced and only add an `extends` line?
- Open: what strictness does the base fix? The two generators ship opposite
  defaults — the Nest CLI template leaves several `strict*` flags off, including
  `noImplicitAny`, while `npm create vite` react-ts turns full `strict` on and
  adds `noUnusedLocals` and `noUnusedParameters`. Whichever way this goes, one of
  the two apps has to be adjusted to match.
- Why it cannot be guessed: the api and web units are built in parallel by
  separate agents against whatever root wrote. Getting it wrong yields two apps
  compiled to different standards.
- Already settled, and not part of this question: the base must not set `jsx`,
  `module`, `moduleResolution`, `outDir`, `rootDir`, `experimentalDecorators`,
  `emitDecoratorMetadata` or `types` — Nest and Vite need conflicting values for
  each, so each app owns them.
- Would land in `tech-stack.md` as a new §4.10, alongside §4.9.

## 4.11.a How `just dev` starts both apps at once
- Raised by the scaffold report agent, run 2, not by a clarify agent. The clarify
  agent settled it inside a requirement rather than raising it as a gap, so it
  has never been put to anyone.
- §4.8 fixes npm workspaces, and no note names a process runner. The root
  requirement list forbids adding any package `tech-stack.md` does not name, so
  `concurrently` and `npm-run-all` are both out by default.
- Open: what does the `dev` recipe actually contain? `npm run dev --workspaces`
  runs workspaces one after another, so the api would start and the web app would
  never be reached. Backgrounding both from the recipe with `&` and `wait` works
  but leaves signal handling and log interleaving to the shell.
- Open, and cheaper if the answer is yes: is adding a process runner acceptable
  after all, which would make this three lines and no shell subtleties?
- Cannot be exercised until `apps/api` and `apps/web` exist, so root review
  records the recipe as a deferred check either way.
- Would land in `tech-stack.md` as a new §4.11 covering the top-level commands.

## 4.1.b Does the frontend scaffold install `react-router-dom`?
- Raised by the scaffold report agent, run 2. It is a conflict between two files
  in this repository, not a missing decision.
- `tech-stack.md` §4.1 names `react-router-dom`, plain nested routes, no data
  loaders, no framework mode.
- `.claude/workflows/scaffold.js`, frontend brief, still says "Routing is not
  decided yet. Do not install a router; leave a TODO naming it." It predates the
  §4.1 answer.
- Open: does the scaffold unit install the router and wire a minimal route tree
  now that §4.1 has chosen one, or does the scaffold stay router-free and routing
  arrive with the first feature that needs a second screen?
- Whichever it is, the brief in the workflow script needs updating to match, or
  the frontend clarify agent will hit the contradiction on its first pass.
- Related staleness in the same script, milder: the backend brief describes the
  database connection as a local file path for test and dev plus a Turso URL when
  deployed, which predates §4.6.1's single `DATABASE_URL`. Compatible, but the
  brief should say what §4.6.1 says.

## Decisions implementers made alone, scaffold run 2
- None. No implement agent ran — root did not clear clarify, and the apps were
  skipped rather than built on a base that does not exist.

## 4.10.b Which TypeScript version the repository pins
- Raised by the backend implementer and confirmed by its reviewer, scaffold run
  3. It is the one thing blocking a working `just build`.
- `@nestjs/schematics` 12 declares a peer of `typescript >=6.0.0`. The root
  pins `typescript: ^5`, so `npm install` satisfies the peer by nesting
  `typescript@7.0.2` in `apps/api/node_modules`. The Nest CLI resolves
  TypeScript from the project directory, finds 7.0.2, and refuses it —
  TypeScript 7.0 ships the `tsc` executable only, not the programmatic compiler
  API the CLI needs. `nest build` and `nest start --watch` both exit 1.
- Open: does the root `package.json` gain
  `"overrides": { "typescript": "$typescript" }`, pinning the whole repository
  to one TypeScript? Verified working — with 5.9.3 resolved for `apps/api`,
  `nest build` exits 0, `nest start --watch` boots, and `/health` answers 200.
  It changes nothing else.
- Open, the alternative: does the repository move to TypeScript 6? Then
  `apps/api/tsconfig.json` cannot keep `module: commonjs`, because TypeScript 6
  rejects `moduleResolution: node10` as deprecated and `commonjs` accepts no
  other resolution mode. It would become `nodenext`/`nodenext`, still emitting
  CommonJS since `apps/api/package.json` has no `"type": "module"`.
- Why no unit could decide it: npm honours `overrides` only in the root
  `package.json`, and every unit was required to leave files outside its own
  directory byte-identical. Adding `typescript` to `apps/api`, adding an
  `.npmrc`, or switching the CLI to the SWC builder each break a different
  requirement in the backend brief.
- A TODO naming this sits at the top of `apps/api/tsconfig.json`.

## 4.9.a Who lints and formats the committed workflow scripts
- Raised by the root implementer, scaffold run 3, and accepted by its reviewer
  as forced rather than gratuitous.
- §4.8 commits `.claude/` because the workflow scripts are part of what is being
  judged. §4.9 gives the repository one shared ESLint config and one shared
  Prettier config. Nothing says the scripts are subject to either.
- They are not plain Node modules: the workflow runner injects `agent`, `log`,
  `phase` and `pipeline` as globals, so `npx eslint .` reports 11 `no-undef`
  errors on `scaffold.js`, and `prettier --write .` wants to rewrite it.
- Decided alone, to keep `just lint` and `just format` exiting 0: `.claude` was
  added to the global `ignores` in the root `eslint.config.mjs` and to
  `.prettierignore`. Both carry a comment saying why.
- Open: are the workflow scripts linted and formatted at all? If yes, the runner
  globals have to be declared somewhere — which the root brief forbade the
  shared config from doing — or `.claude/` needs a config of its own. If no,
  the two ignore entries become the answer rather than a workaround.

## 4.2.a Where `@types/node` is declared
- Raised by the frontend implementer, scaffold run 3, and independently
  confirmed by its reviewer.
- `apps/web/tsconfig.node.json` sets `types: ["node"]` and
  `apps/web/vite.config.ts` imports `fileURLToPath` from `node:url`, so the web
  app needs Node's types. Its dependency list was fixed at exactly seven
  packages, and `@types/node` is not one of them, nor is it in the root
  `package.json`.
- It resolves today only because `apps/api` declares `@types/node` and npm
  workspaces hoists it to the repository root. `apps/web/node_modules` contains
  no `@types` directory at all.
- Consequence: `npm run build -w apps/web` works from the root as required, but
  the web workspace is not self-contained — it builds because of a package a
  different workspace happens to declare.
- Open: does `@types/node` move to the root `devDependencies`, where both apps
  can rely on it, or does `apps/web` declare its own copy and the seven-package
  list grow to eight?

## 4.1.c Strict `import.meta.env` typing in the web app
- Raised by the frontend implementer as a TODO in `apps/web/src/vite-env.d.ts`,
  and recorded by its reviewer as the unit's one unmet requirement.
- The frontend brief specified the file's contents exactly, and justified them
  by saying a typo in the variable name would fail `tsc -b`. It does not.
  Verified with a deliberately misspelled probe, which compiled clean.
- Cause, in `node_modules/vite/types/importMeta.d.ts`: Vite's own
  `ImportMetaEnv` extends `Record<string, any>` unless some module declares
  `interface ViteTypeOptions { strictImportMetaEnv: unknown }`. The brief never
  mentioned that opt-in, so the declaration documents `VITE_API_BASE_URL` but
  catches nothing.
- Decided alone: leave the file exactly as specified and write the TODO, rather
  than add a line the requirement did not ask for.
- Open: does the web app opt in — one line, and every unknown `import.meta.env`
  key becomes a type error — or does the requirement's justification get
  amended to say the declaration is documentation only?

## 4.4.a Which `better-sqlite3` major the repository declares
- Raised by the backend implementer, scaffold run 3. Its own account of this is
  wrong in the detail and right in the worry — see `scaffold-report.md` §5.
- `apps/api` declares `better-sqlite3: ^13.0.3`. TypeORM 1.1.1 declares
  `better-sqlite3: ^12.0.0` as an optional peer. On disk there is exactly one
  copy, 13.0.3, nested at `apps/api/node_modules/better-sqlite3`; there is no
  12.x anywhere and no duplicate native build.
- What makes it work is not ordinary resolution. TypeORM lives in the root
  `node_modules`, and `require('better-sqlite3')` from there fails outright.
  TypeORM's `PlatformTools.load` falls back to
  `require(process.cwd() + '/node_modules/' + name)`, and every supported
  command runs with the working directory at `apps/api`, so the fallback lands.
- Consequence: `node apps/api/dist/main.js` launched from the repository root
  would fail to load the driver, while `npm run start -w apps/api` succeeds.
- Open: does `apps/api` declare `better-sqlite3` at `^12` so the tree dedupes
  to the version TypeORM peers against and hoists to the root, or does the
  repository accept that the driver is reachable only from the app's own
  working directory?

## 4.7.a The Vitest config's ESM-in-CommonJS warning
- Raised by the backend implementer and repeated by its reviewer, scaffold run
  3. Cosmetic, and recorded only so it is a decision rather than a shrug.
- Every `npm run test -w apps/api` run prints: the Vite config uses ESM syntax
  in a file loaded as CommonJS (`vitest.config.ts:1:1`), and suggests a `.mjs`
  extension or `"type": "module"`. The run exits 0 and all 7 tests pass.
- Both suggested fixes were ruled out by the backend brief: `apps/api` must not
  have `"type": "module"` — `nest build` emits CommonJS and `node dist/main.js`
  expects it — and the file was specified as `vitest.config.ts`.
- Open: is the warning suppressed with `VITE_CONFIG_NATIVE_IGNORE_WARNING`, is
  the config renamed to `vitest.config.mts`, or does it stay as noise on every
  test run until Vite makes the native loader the default and it becomes an
  error?

## 4.1.d The frontend requirement list is stale against the Vite template
- Raised by the frontend reviewer, scaffold run 3, as something it decided
  rather than failed.
- The brief named `isolatedModules` among the options the app tsconfigs keep.
  Neither `tsconfig.app.json` nor `tsconfig.node.json` has it. The reviewer
  unpacked `create-vite` 9.2.1 and confirmed the current react-ts template does
  not emit it at all, so nothing generated was dropped, and
  `verbatimModuleSyntax` — which is present — covers the same hazard.
- The same comparison shows the committed tsconfigs follow the older Vite 7-era
  template shape: `ES2022` + `DOM.Iterable` rather than `es2023`,
  `noUncheckedSideEffectImports` present, `allowArbitraryExtensions` absent.
  All inert; `tsc -b` passes.
- Decided alone: read the brief's closing "whatever else the template generated
  is kept as generated" as governing, and not fail the unit.
- Open: does anyone refresh the frontend brief against the generator it now
  produces, or does the scaffold stop describing template output option by
  option and just say which options the app owns?

## Decisions implementers made alone, scaffold run 3
- Seven, each written up above rather than summarised here: §4.10.b (the
  TypeScript pin, blocking), §4.9.a (ignoring `.claude` in both the ESLint and
  Prettier configs), §4.2.a (relying on a hoisted `@types/node`), §4.1.c
  (leaving strict `import.meta.env` typing off), §4.4.a (declaring
  `better-sqlite3` at `^13`), §4.7.a (living with the Vitest config warning),
  and §4.1.d (treating the stale template options as kept-as-generated).
- Nothing else was decided unilaterally. All three clarify agents returned zero
  gaps, so every other choice traces to `tech-stack.md` or to a numbered
  requirement.
- Note for whoever prunes this file: §4.10.a, §4.11.a and §4.1.b are answered.
  `tech-stack.md` §4.10, §4.11 and §4.1 settle them, all three clarify agents
  said so independently, and the stale brief behind §4.1.b has been corrected in
  `.claude/workflows/scaffold.js`. They survive here only because agents append
  and never resolve.
