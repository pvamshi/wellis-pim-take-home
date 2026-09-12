import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TemporaryDatabase {
  /** The temporary directory holding the database file and its sidecars. */
  directory: string;
  /** Absolute path of the database file itself. */
  file: string;
  /** The `file:` URL that DATABASE_URL is set to for the suite. */
  url: string;
  /** Removes the whole directory, sidecar -wal and -shm files included. */
  cleanup: () => void;
}

/**
 * One real SQLite file per suite, outside the repository. Tests run against a
 * real database rather than mocks, and nothing is written inside apps/api.
 */
export function createTemporaryDatabase(): TemporaryDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'wellis-api-'));
  const file = join(directory, 'test.sqlite');

  return {
    directory,
    file,
    url: `file:${file}`,
    cleanup: (): void => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
