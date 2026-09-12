# Unresolved questions

Ambiguities. Things we could not decide, or that need someone else to answer.

An answered question moves out of here — into `tech-stack.md` if it settles a
technology decision, into `rough-drafts.md` if it only narrows the shape, into
`final-requirements.md` once Vamshi approves it as a requirement.

Agents append here. Agents never resolve anything here.

## 4.1.a Routing
- No router chosen for the frontend. Not needed for the health-check page, needed
  the moment there is more than one screen.

## 1.1.b Where rules live
- Rules are created by AI and updated from feedback. Are they code in the repo,
  versioned by git and changed by deploy, or rows in a table, changed at runtime?
- This decides what "the engine keeps improving" means in the running app.

## 1.5.a What a declined rule becomes
- When a rule is declined, does it disappear, or stay as a dead version with the
  comment attached?
- Also open: what happens to rows that rule already changed.

## 4.a Linter and formatter
- Raised by the scaffold clarify agent, root unit. It blocked the root unit.
- Nothing anywhere names a linter or a formatter, yet the root scaffold is asked
  for shared lint and format config.
- ESLint flat config plus Prettier, or one all-in-one tool such as Biome?
- The fork is not cosmetic: ESLint+Prettier is what the Nest CLI and
  `npm create vite` generate, so choosing it means hoisting and de-duplicating
  what the apps produce. Biome means deleting those generated configs outright.
  Different root files, different root devDependencies, opposite instructions to
  the two app units.
- The backend brief names exactly one deviation from Nest CLI defaults (Vitest,
  not Jest) and says nothing about lint. Is that silence a decision to keep the
  defaults?

## 4.6.a Database environment variables
- Raised by the scaffold clarify agent, root unit. It blocked the root unit.
- `.env.example` is the contract the api and web units get built against, in
  parallel, by separate agents. No variable in it has a name yet.
- One `DATABASE_URL`, or `SQLITE_PATH` alongside `TURSO_DATABASE_URL` and
  `TURSO_AUTH_TOKEN`?
- §4.6 says separate local files for test, dev and production-shaped runs. Is
  that three variables, or one variable whose value differs across `.env`,
  `.env.test` and so on?
- What makes the config module pick Turso over a file — the presence of a Turso
  URL, an explicit mode variable, or `NODE_ENV`?

## 4.6.b The two non-database environment variables
- Raised by the scaffold clarify agent, root unit. Same blocker as 4.6.a.
- What is the backend's listen port variable called, and what does it default to?
- What is the frontend's API base URL variable called, and what does it default
  to? It must carry Vite's `VITE_` prefix or Vite will not expose it to client
  code.
- Both halves read these. If root does not fix the names, each app invents its
  own and they do not talk.

## 4.5.a Where the two apps are deployed
- Raised by the scaffold clarify agent, root unit.
- §4.5 settles how the database gets to production — upload the SQLite file to
  Turso — but no host is chosen for the api or the web app.
- Until one is, "every environment variable the stack needs" cannot include
  whatever that platform requires, so `.env.example` stays incomplete even after
  4.6.a and 4.6.b are answered.

## 4.8.a Is `.claude/` committed?
- Raised while writing the scaffold report, from the state of the working tree.
- `.claude/workflows/scaffold.js` is untracked and ignored by nothing. §5 treats
  workflow scripts as part of the project; the root `.gitignore` requirements
  list does not mention `.claude/` in either direction.
- Track it, or ignore it?
- Adjacent: `.memcli/` is currently invisible only because this machine's global
  gitignore excludes it. A fresh clone elsewhere has no such exclusion. Should
  the repo ignore it explicitly?

## 4.2.a Node version the backend targets
- Raised while writing the scaffold report, from the state of the machine.
- This machine runs Node 25.2.1. `better-sqlite3` and `libsql` — the pair §4.6
  depends on — ship prebuilt binaries for a lagging window of Node majors, and
  25 is ahead of it, so installing them compiles from source or fails.
- Nothing pins a Node version: no `.nvmrc`, no `engines` field.
- Which Node major does this project build and run against?
