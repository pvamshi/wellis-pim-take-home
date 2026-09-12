import { isAbsolute } from 'node:path';
import LibsqlDatabase from 'libsql';
import { describe, expect, it } from 'vitest';
import { buildDataSourceOptions } from '../src/config/database-url';

describe('buildDataSourceOptions', () => {
  it('maps a file: URL onto an absolute path, driven by libsql', () => {
    const options = buildDataSourceOptions({ DATABASE_URL: 'file:/tmp/wellis/dev.sqlite' });

    expect(options.type).toBe('better-sqlite3');
    expect(isAbsolute(options.database)).toBe(true);
    expect(options.database).toBe('/tmp/wellis/dev.sqlite');
    expect(options.driver).toBe(LibsqlDatabase);
  });

  it('maps a libsql:// URL onto a driver carrying the auth token', () => {
    const url = 'libsql://wellis-pim.turso.io';
    const options = buildDataSourceOptions({ DATABASE_URL: url, TURSO_AUTH_TOKEN: 'token' });

    expect(options.type).toBe('better-sqlite3');
    expect(options.database).toBe(url);
    expect(options.driver).toBeDefined();
  });

  it('names DATABASE_URL when it is missing', () => {
    expect(() => buildDataSourceOptions({})).toThrow(/DATABASE_URL/);
  });

  it('names DATABASE_URL when its scheme is neither file: nor libsql://', () => {
    expect(() => buildDataSourceOptions({ DATABASE_URL: 'postgres://localhost/wellis' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('names TURSO_AUTH_TOKEN when a libsql:// URL has no token', () => {
    expect(() => buildDataSourceOptions({ DATABASE_URL: 'libsql://wellis-pim.turso.io' })).toThrow(
      /TURSO_AUTH_TOKEN/,
    );
  });
});
