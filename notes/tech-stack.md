# Tech stack

Decisions taken. This is the source of truth agents read before building
anything. Numbers are addresses, not order — they are never renumbered.

Anything still open lives in `unresolved-questions.md`, never here as a guess.

## 4. Tech stack
- Not a blank slate. Start from a known stack so we can begin immediately.

### 4.1 Frontend
- React + TypeScript, built with Vite.
- Mantine as the component library, core packages only.
- No data grid library. Mantine's `Table` is a styling primitive, not a grid, and
  our tables are simple. Revisit only when a real need appears.
- Routing: `react-router-dom`. Plain nested routes, no data loaders, no framework
  mode. We need a handful of screens, not a routing architecture.

### 4.2 Backend
- Node + TypeScript, NestJS.
- Chosen for dependency injection, testability, and structure.
- Node 22 LTS, pinned by `.nvmrc` and an `engines` field. `better-sqlite3` and
  `libsql` ship prebuilt binaries for a lagging window of Node majors; on a newer
  major they compile from source or fail outright.

### 4.3 Database
- SQLite. Simple locally.
- Turso in production.

### 4.4 ORM and migrations
- TypeORM. No Prisma.
- No migration tooling. There is no long chain of migrations to replay — there is
  one final state.

### 4.5 Getting to production
- Generate the SQLite database locally, then upload that file to Turso directly.

### 4.6 Database connection per environment
- Local is a file. Separate files for test, dev and production-shaped runs.
- Deployment points at Turso with an auth token.
- TypeORM has no libSQL driver. Route is TypeORM's better-sqlite3 driver with the
  `libsql` package handed in as the driver module — it exposes a
  better-sqlite3-compatible API.
- All of this sits behind one config module, so the rest of the app never knows
  which it is talking to.
- `better-sqlite3` the package is never installed. Both branches hand `libsql` to
  TypeORM as the driver module — it opens a local file as happily as a Turso URL.
  Installing better-sqlite3 as well means a second native module that compiles
  from source on any Node past its prebuild window, and it buys nothing.
- TypeScript: the root is on 5 (typescript-eslint does not support 6 yet),
  `apps/api` pins 6 because the Nest CLI reads the copy in its own node_modules
  and `@nestjs/schematics` 12 peers on `>=6`. `apps/api` therefore uses
  `module: nodenext`, since 6 rejects the `node10` resolution Nest templates ship.

#### 4.6.1 Environment variables
- `DATABASE_URL` — one variable. Its scheme selects the driver:
  `file:./data/dev.sqlite` locally, `libsql://…` when deployed. Nothing else
  decides; not `NODE_ENV`, not a mode flag.
- `TURSO_AUTH_TOKEN` — set only when the scheme is `libsql://`. Absent locally.
- Test, dev and production-shaped runs differ by which `.env` file is loaded, not
  by having three path variables.
- `PORT` — backend listen port, defaults to 3000.
- `VITE_API_BASE_URL` — frontend's backend base URL, defaults to
  `http://localhost:3000`. The `VITE_` prefix is mandatory or Vite will not
  expose it to client code.
- `.env.example` carries all four, with both database shapes shown — one active,
  one commented — and no real credential values.

### 4.7 Testing
- Frontend: no tests. Deliberate cut, to keep it simple.
- Backend: Vitest.
- Tests run against a real temporary SQLite database rather than mocks.

### 4.8 Repository layout
- npm workspaces. `apps/api` for the backend, `apps/web` for the frontend.
- `.claude/` is committed. The workflow scripts are how the work was directed,
  which is part of what this project is being judged on.
- `.memcli/` is explicitly ignored. It is a local, machine-specific store.

### 4.10 Shared TypeScript config
- `tsconfig.base.json` at the root is the real config. Each app's generated
  tsconfig is trimmed to `extends` plus only the options that app must own.
- The base fixes strictness for both apps: `strict: true`, `noUnusedLocals`,
  `noUnusedParameters`, `esModuleInterop`, `skipLibCheck`,
  `forceConsistentCasingInFileNames`, `resolveJsonModule`.
- The Nest CLI template ships several `strict*` flags off, including
  `noImplicitAny`. It gets adjusted up to match. Vite's react-ts defaults already
  agree.
- The base must NOT set `jsx`, `module`, `moduleResolution`, `outDir`, `rootDir`,
  `experimentalDecorators`, `emitDecoratorMetadata` or `types`. Nest and Vite
  need conflicting values for each, so each app owns them.

### 4.11 Top-level commands
- `concurrently` is allowed, as a root devDependency, so `just dev` starts both
  apps in three lines instead of shell backgrounding with `&` and `wait`.
- `npm run dev --workspaces` is not an option: it runs workspaces one after
  another, so the api would start and the web app would never be reached.

### 4.9 Lint and format
- ESLint flat config plus Prettier. One shared config each at the repository
  root; both apps extend by reference and carry no copy of their own.
- The Nest CLI and `npm create vite` both generate ESLint setups — those get
  hoisted and de-duplicated into the shared config, not left in place.
