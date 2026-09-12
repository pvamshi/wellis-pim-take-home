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

### 4.2 Backend
- Node + TypeScript, NestJS.
- Chosen for dependency injection, testability, and structure.

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

### 4.7 Testing
- Frontend: no tests. Deliberate cut, to keep it simple.
- Backend: Vitest.
- Tests run against a real temporary SQLite database rather than mocks.

### 4.8 Repository layout
- npm workspaces. `apps/api` for the backend, `apps/web` for the frontend.
