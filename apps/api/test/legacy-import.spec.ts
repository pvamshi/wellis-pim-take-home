import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type EntityTarget, type Logger, type ObjectLiteral } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyImportService, type LegacyFileReport } from '../src/import/legacy-import.service';
import { legacySources, type LegacySource } from '../src/import/legacy-sources';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The ceiling the service chunks against. Repeated here rather than imported so
 * the expectations below are an independent statement of what the import must
 * do, not a restatement of what it does.
 */
const MAX_BOUND_PARAMETERS = 32766;

/**
 * The export sits at the repository root while the suite runs from `apps/api`.
 * Walking up finds it from either, so the spec does not hard-code how it was
 * launched.
 */
function findLegacyExportDirectory(): string {
  let directory = process.cwd();

  for (;;) {
    const candidate = join(directory, 'legacy_export');

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error(`legacy_export/ was not found above ${process.cwd()}`);
    }

    directory = parent;
  }
}

const legacyExport = findLegacyExportDirectory();

function sourceText(fileName: string): string {
  return readFileSync(join(legacyExport, fileName), 'utf8');
}

/** The export's own lines, terminators removed, blanks dropped. */
function sourceLines(fileName: string): string[] {
  return sourceText(fileName)
    .split(/\r?\n/)
    .filter((line) => line !== '');
}

/**
 * How many rows the file actually holds — computed from the file at test time,
 * never hard-coded, so the expectations follow the export rather than a number
 * someone typed once.
 */
function dataRowCount(fileName: string): number {
  const lines = sourceLines(fileName);

  return fileName.endsWith('.csv') ? lines.length - 1 : lines.length;
}

function descriptorFor(fileName: string): LegacySource {
  const source = legacySources.find((candidate) => candidate.file === fileName);

  if (source === undefined) {
    throw new Error(`no legacy source describes ${fileName}`);
  }

  return source;
}

/** Records every statement the connection runs, so the shape of the import is assertable. */
class RecordingLogger implements Logger {
  readonly queries: string[] = [];

  logQuery(query: string): void {
    this.queries.push(query);
  }

  logQueryError(): void {}
  logQuerySlow(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

interface Harness {
  readonly dataSource: DataSource;
  readonly service: LegacyImportService;
  /** Every statement run since the last `clearQueries()`. */
  readonly queries: string[];
  clearQueries(): void;
  countRows(table: string): Promise<number>;
  close(): Promise<void>;
}

/**
 * A real temporary database with the app booted against it — schema sync is what
 * creates the tables, and the import is pulled off the same container the api
 * would resolve it from.
 */
async function startHarness(): Promise<Harness> {
  const database: TemporaryDatabase = createTemporaryDatabase();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = database.url;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();

  const dataSource = moduleRef.get(DataSource);
  const logger = new RecordingLogger();
  dataSource.logger = logger;

  return {
    dataSource,
    service: moduleRef.get(LegacyImportService),
    queries: logger.queries,
    clearQueries: (): void => {
      logger.queries.length = 0;
    },
    countRows: async (table: string): Promise<number> => {
      const rows = await dataSource.query<{ total: number }[]>(
        `SELECT COUNT(*) AS total FROM ${table}`,
      );

      return rows[0].total;
    },
    close: async (): Promise<void> => {
      await app.close();

      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }

      database.cleanup();
    },
  };
}

function insertsInto(queries: readonly string[], table: string): string[] {
  return queries.filter((query) => query.startsWith(`INSERT INTO "${table}"`));
}

function selectsFrom(queries: readonly string[], table: string): string[] {
  return queries.filter((query) => query.startsWith('SELECT') && query.includes(`FROM "${table}"`));
}

function reportFor(reports: readonly LegacyFileReport[], file: string): LegacyFileReport {
  const report = reports.find((candidate) => candidate.file === file);

  if (report === undefined) {
    throw new Error(`the import did not report on ${file}`);
  }

  return report;
}

// --- fixture export -------------------------------------------------------

/** The real export's header, so a fixture cannot drift away from the real file. */
function headerOf(fileName: string): string[] {
  return sourceLines(fileName)[0].split(',');
}

/** A CSV line in the real header's order, quoted only where a field needs it. */
function csvLine(fileName: string, values: Record<string, string>): string {
  return headerOf(fileName)
    .map((column) => {
      const value = values[column] ?? '';

      return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    })
    .join(',');
}

interface FixtureExport {
  readonly patients?: readonly string[];
  readonly intakes?: readonly string[];
  readonly consents?: readonly string[];
}

const fixtureDirectories: string[] = [];

/**
 * A throwaway `legacy_export/`-shaped directory. All three files always exist —
 * the import is strict about that — and default to holding no data rows.
 */
function writeFixtureExport(files: FixtureExport): string {
  const directory = mkdtempSync(join(tmpdir(), 'wellis-export-'));
  fixtureDirectories.push(directory);

  const writeCsv = (fileName: string, rows: readonly string[]): void => {
    writeFileSync(
      join(directory, fileName),
      [sourceLines(fileName)[0], ...rows].map((line) => `${line}\r\n`).join(''),
    );
  };

  writeCsv('patients.csv', files.patients ?? []);
  writeCsv('intakes.csv', files.intakes ?? []);
  writeFileSync(
    join(directory, 'consents.jsonl'),
    (files.consents ?? []).map((line) => `${line}\n`).join(''),
  );

  return directory;
}

afterAll(() => {
  for (const directory of fixtureDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// --- the real export ------------------------------------------------------

describe('importing legacy_export/', () => {
  let harness: Harness;
  let firstRun: LegacyFileReport[];
  let firstRunQueries: string[];
  let countsAfterFirstRun: Record<string, number>;
  let secondRun: LegacyFileReport[];
  let countsAfterSecondRun: Record<string, number>;

  const tables = ['legacy_patient', 'legacy_intake', 'legacy_consent'];

  const countAll = async (): Promise<Record<string, number>> => {
    const counts: Record<string, number> = {};

    for (const table of tables) {
      counts[table] = await harness.countRows(table);
    }

    return counts;
  };

  beforeAll(async () => {
    harness = await startHarness();

    harness.clearQueries();
    firstRun = await harness.service.importAll(legacyExport);
    firstRunQueries = [...harness.queries];
    countsAfterFirstRun = await countAll();

    harness.clearQueries();
    secondRun = await harness.service.importAll(legacyExport);
    countsAfterSecondRun = await countAll();
  }, 120_000);

  afterAll(async () => {
    await harness.close();
  });

  it('reads and inserts every data row of every file', () => {
    expect(firstRun.map((report) => report.file)).toEqual([
      'patients.csv',
      'intakes.csv',
      'consents.jsonl',
    ]);

    for (const report of firstRun) {
      const rows = dataRowCount(report.file);

      expect(rows).toBeGreaterThan(0);
      expect(report).toMatchObject({ read: rows, inserted: rows, skipped: 0 });
      expect(countsAfterFirstRun[report.table]).toBe(rows);
    }
  });

  it('reports three numbers that reconcile, on both runs', () => {
    for (const report of [...firstRun, ...secondRun]) {
      expect(report.inserted + report.skipped).toBe(report.read);
    }
  });

  it.each(legacySources.map((source) => source.file))(
    'resolves existence for %s with exactly one IN query',
    (file) => {
      const source = descriptorFor(file);
      const selects = selectsFrom(firstRunQueries, source.table);

      expect(selects).toHaveLength(1);
      expect(selects[0]).toContain(' IN (');
    },
  );

  it.each(legacySources.map((source) => source.file))(
    'inserts %s in bulk, not row by row',
    (file) => {
      const source = descriptorFor(file);
      const columns = harness.dataSource.getMetadata(source.entity).columns.length;
      const rowsPerStatement = Math.floor(MAX_BOUND_PARAMETERS / columns);
      const rows = dataRowCount(file);

      // The fewest statements SQLite's bound-parameter ceiling allows: 2 for
      // patients, 2 for intakes, 1 for consents. Anything row-by-row would be
      // three orders of magnitude more.
      expect(rowsPerStatement * columns).toBeLessThanOrEqual(MAX_BOUND_PARAMETERS);
      expect(insertsInto(firstRunQueries, source.table)).toHaveLength(
        Math.ceil(rows / rowsPerStatement),
      );
      expect(insertsInto(firstRunQueries, source.table).length).toBeLessThan(rows / 100);
    },
  );

  it('keeps a quoted field containing a comma byte for byte in rawData', async () => {
    const line = sourceLines('intakes.csv')
      .slice(1)
      .find((candidate) => candidate.includes(',"'));

    if (line === undefined) {
      throw new Error('intakes.csv has no quoted field');
    }

    const intakeId = line.slice(0, line.indexOf(','));
    const stored = await harness.dataSource
      .getRepository(LegacyIntake)
      .findOneByOrFail({ legacyIntakeId: intakeId });

    // The quotes and the comma survive in rawData exactly as written...
    expect(stored.rawData).toBe(line);
    expect(stored.rawData).toContain(',"');
    // ...and the column holds the field's value, unquoted, comma and all.
    expect(stored.reviewerNote).toContain(',');
    expect(line).toContain(`"${stored.reviewerNote}"`);
  });

  it('lands every export column in its own column, trimming and parsing nothing', async () => {
    expect(sourceText('patients.csv')).not.toContain('"');

    const header = headerOf('patients.csv');
    const line = sourceLines('patients.csv')
      .slice(1)
      .find((candidate) => {
        const status = candidate.split(',')[header.indexOf('status')];

        return status !== status.trim();
      });

    if (line === undefined) {
      throw new Error('patients.csv has no row whose status carries surrounding whitespace');
    }

    const fields = line.split(',');

    // Read back by the export's own column names, not through the entity, so a
    // descriptor that mapped a column onto the wrong property fails here.
    const rows = await harness.dataSource.query<Record<string, unknown>[]>(
      `SELECT * FROM legacy_patient WHERE legacy_id = ?`,
      [fields[header.indexOf('legacy_id')]],
    );

    expect(rows).toHaveLength(1);
    expect(header.map((column) => rows[0][column])).toEqual(fields);
    expect(rows[0].status).not.toBe((rows[0].status as string).trim());
    expect(rows[0].raw_data).toBe(line);
  });

  it('creates nothing on a second run and counts every row as skipped', () => {
    for (const report of secondRun) {
      const rows = dataRowCount(report.file);

      expect(report).toMatchObject({ read: rows, inserted: 0, skipped: rows });
    }

    expect(countsAfterSecondRun).toEqual(countsAfterFirstRun);
  });
});

// --- fixtures -------------------------------------------------------------

describe('an id already in the database', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('is skipped without its values being looked at', async () => {
    const first = writeFixtureExport({
      patients: [csvLine('patients.csv', { legacy_id: 'recABC', email: 'a@x.nl' })],
    });
    const second = writeFixtureExport({
      patients: [csvLine('patients.csv', { legacy_id: 'recABC', email: 'b@x.nl' })],
    });

    await harness.service.importAll(first);
    const report = reportFor(await harness.service.importAll(second), 'patients.csv');

    const stored = await harness.dataSource.getRepository(LegacyPatient).findBy({
      legacyPatientId: 'recABC',
    });

    expect(report).toMatchObject({ read: 1, inserted: 0, skipped: 1 });
    expect(stored).toHaveLength(1);
    expect(stored[0].email).toBe('a@x.nl');
  });
});

describe('a legacy id repeated inside one file', () => {
  let harness: Harness;
  let report: LegacyFileReport;
  let importQueries: string[];
  let stored: LegacyPatient[];

  beforeAll(async () => {
    harness = await startHarness();

    const directory = writeFixtureExport({
      patients: [
        csvLine('patients.csv', { legacy_id: 'recDUP', email: 'first@x.nl' }),
        csvLine('patients.csv', { legacy_id: 'recDUP', email: 'second@x.nl' }),
      ],
    });

    harness.clearQueries();
    report = reportFor(await harness.service.importAll(directory), 'patients.csv');
    importQueries = [...harness.queries];
    stored = await harness.dataSource.getRepository(LegacyPatient).findBy({
      legacyPatientId: 'recDUP',
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('inserts both rows, each with an id of our own', () => {
    expect(report).toMatchObject({ read: 2, inserted: 2, skipped: 0 });
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((row) => row.id)).size).toBe(2);
    expect(stored.map((row) => row.email).sort()).toEqual(['first@x.nl', 'second@x.nl']);
  });

  it('de-duplicates the lookup but not the batch', () => {
    const selects = selectsFrom(importQueries, 'legacy_patient');

    // One id in the IN list, two rows in the one insert: the lookup asks about
    // distinct ids because asking twice answers the same question, while the
    // batch keeps every occurrence.
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain(' IN (?)');
    expect(insertsInto(importQueries, 'legacy_patient')).toHaveLength(1);
  });
});

describe('two identical consent lines', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('become two consent rows', async () => {
    const line = JSON.stringify({
      patient_legacy_id: 'recCONSENT',
      type: 'data_processing',
      action: 'granted',
      at: '2024-05-06T07:37:00',
      version: 'v2',
    });
    const directory = writeFixtureExport({ consents: [line, line] });

    const report = reportFor(await harness.service.importAll(directory), 'consents.jsonl');
    const stored = await harness.dataSource.getRepository(LegacyConsent).findBy({
      legacyPatientId: 'recCONSENT',
    });

    expect(report).toMatchObject({ read: 2, inserted: 2, skipped: 0 });
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.rawData)).toEqual([line, line]);
    expect(new Set(stored.map((row) => row.id)).size).toBe(2);
  });
});

describe('an empty source file', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('reports zeroes and runs no statement against its table', async () => {
    harness.clearQueries();

    const reports = await harness.service.importAll(writeFixtureExport({}));
    const tables: EntityTarget<ObjectLiteral>[] = [LegacyPatient, LegacyIntake, LegacyConsent];

    for (const report of reports) {
      expect(report).toMatchObject({ read: 0, inserted: 0, skipped: 0 });
    }

    for (const entity of tables) {
      const table = harness.dataSource.getMetadata(entity).tableName;

      expect(selectsFrom(harness.queries, table)).toHaveLength(0);
      expect(insertsInto(harness.queries, table)).toHaveLength(0);
    }
  });
});
