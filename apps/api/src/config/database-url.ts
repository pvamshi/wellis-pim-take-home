import { resolve } from 'node:path';
import LibsqlDatabase from 'libsql';
import type { DataSourceOptions } from 'typeorm';

/**
 * The only two environment variables the database connection is allowed to see.
 * Passed in rather than read from `process.env`, so both branches below can be
 * asserted without a database, a filesystem or a network.
 */
export interface DatabaseEnvironment {
  DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
}

/**
 * Both branches speak TypeORM's better-sqlite3 driver, and both hand it `libsql`
 * as the driver module — `libsql` exposes a better-sqlite3-compatible API and
 * opens a local file just as happily as a Turso URL. The `better-sqlite3`
 * package itself is never installed: it is a second native module that would
 * have to compile from source on any Node newer than its prebuilds, and it buys
 * nothing that `libsql` does not already do.
 *
 * `autoLoadEntities` is Nest's, not TypeORM's, and rides along with the options
 * the config module hands to `forRootAsync`.
 */
export type ApiDataSourceOptions = Extract<DataSourceOptions, { type: 'better-sqlite3' }> & {
  autoLoadEntities: true;
};

const FILE_SCHEME = 'file:';
const LIBSQL_SCHEME = 'libsql://';

/**
 * `new URL('file:./data/dev.sqlite')` normalises to `file:///data/dev.sqlite` —
 * an absolute path pointing at the filesystem root. Strip the scheme textually
 * instead, so a relative URL stays relative until it is resolved against the
 * working directory.
 */
function fileUrlToPath(url: string): string {
  const withoutScheme = url.slice(FILE_SCHEME.length);
  const path = withoutScheme.startsWith('//') ? withoutScheme.slice(2) : withoutScheme;
  return resolve(process.cwd(), path);
}

type LibsqlOptions = ConstructorParameters<typeof LibsqlDatabase>[1];
type LibsqlDriver = new (
  filename: string | Buffer,
  options?: LibsqlOptions,
) => InstanceType<typeof LibsqlDatabase>;

/**
 * TypeORM's better-sqlite3 driver forwards no auth-token option of its own, so
 * the token is injected here: a subclass of libsql's `Database` that merges
 * `authToken` into whatever options TypeORM constructs it with.
 */
function libsqlDriverWithAuthToken(authToken: string): LibsqlDriver {
  return class LibsqlDatabaseWithAuthToken extends LibsqlDatabase {
    constructor(filename: string | Buffer, options?: LibsqlOptions) {
      super(filename, { ...options, authToken } as LibsqlOptions);
    }
  };
}

/**
 * The scheme of `DATABASE_URL` is the only thing that selects the driver — not
 * `NODE_ENV`, not a mode flag, not the presence of a Turso token.
 */
export function buildDataSourceOptions(env: DatabaseEnvironment): ApiDataSourceOptions {
  const url = env.DATABASE_URL?.trim();

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env, or export DATABASE_URL, and try again.',
    );
  }

  if (url.startsWith(FILE_SCHEME)) {
    return {
      type: 'better-sqlite3',
      database: fileUrlToPath(url),
      driver: LibsqlDatabase,
      synchronize: true,
      autoLoadEntities: true,
    };
  }

  if (url.startsWith(LIBSQL_SCHEME)) {
    const authToken = env.TURSO_AUTH_TOKEN?.trim();

    if (!authToken) {
      throw new Error(
        'TURSO_AUTH_TOKEN is not set, and DATABASE_URL uses the libsql:// scheme, which needs it.',
      );
    }

    return {
      type: 'better-sqlite3',
      database: url,
      driver: libsqlDriverWithAuthToken(authToken),
      synchronize: true,
      autoLoadEntities: true,
    };
  }

  throw new Error(
    `DATABASE_URL has an unsupported scheme: ${url}. Expected file: or libsql:// and nothing else.`,
  );
}
