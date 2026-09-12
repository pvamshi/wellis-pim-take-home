import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type EntityTarget, type ObjectLiteral } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyConsent } from '../src/legacy/legacy-consent.entity';
import { LegacyIntake } from '../src/legacy/legacy-intake.entity';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * One row of `PRAGMA table_info(<table>)`. SQLite's own column names, so the
 * snake_case is not ours to fix.
 */
interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

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

function linesOf(fileName: string): string[] {
  return readFileSync(join(legacyExport, fileName), 'utf8').split('\n');
}

/** The export's own header, so the expectations below are the source file's. */
function csvColumns(fileName: string): string[] {
  return linesOf(fileName)[0].trim().split(',');
}

function firstCsvLineWithQuotedComma(fileName: string): string {
  const line = linesOf(fileName)
    .slice(1)
    .find((candidate) => candidate.includes(',"') && candidate.includes(', '));

  if (line === undefined) {
    throw new Error(`${fileName} has no quoted field containing a comma`);
  }

  return line;
}

/** consents.jsonl carries its field names in every line rather than a header. */
function jsonlKeys(fileName: string): string[] {
  return Object.keys(JSON.parse(linesOf(fileName)[0]) as Record<string, unknown>);
}

interface LegacySource {
  /** The table the entity is expected to create. */
  readonly table: string;
  readonly entity: EntityTarget<ObjectLiteral>;
  /** The entity property holding the legacy id. */
  readonly legacyIdProperty: string;
  /** Its database column, which is the export's own name for it. */
  readonly legacyIdColumn: string;
  /** Every column of the export, read out of the export at test time. */
  readonly exportColumns: string[];
  /** A source row, as the import would hand it to `rawData`. */
  readonly rawSample: string;
}

const sources: LegacySource[] = [
  {
    table: 'legacy_patient',
    entity: LegacyPatient,
    legacyIdProperty: 'legacyPatientId',
    legacyIdColumn: 'legacy_id',
    exportColumns: csvColumns('patients.csv'),
    // patients.csv happens to carry no quoted field, so this is a constructed
    // line: a name and a city that both contain a comma inside quotes, which is
    // exactly the shape a column-splitting store would mangle.
    rawSample:
      'recQUOTED,"Jansen, Piet",piet@example.nl,01/02/1980,M,,+31 6 12 34 56 78,' +
      '"Den Haag, ZH",82,kg,181,Active,2024-03-01,typeform',
  },
  {
    table: 'legacy_intake',
    entity: LegacyIntake,
    legacyIdProperty: 'legacyIntakeId',
    legacyIdColumn: 'intake_id',
    exportColumns: csvColumns('intakes.csv'),
    rawSample: firstCsvLineWithQuotedComma('intakes.csv'),
  },
  {
    table: 'legacy_consent',
    entity: LegacyConsent,
    legacyIdProperty: 'legacyPatientId',
    legacyIdColumn: 'patient_legacy_id',
    exportColumns: jsonlKeys('consents.jsonl'),
    rawSample: linesOf('consents.jsonl')[0],
  },
];

describe('legacy data entities', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // Booting is the whole point: `synchronize: true` is what creates the
    // tables, and there is no migration step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app.close();

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    database.cleanup();
  });

  it('creates all three legacy tables by schema sync alone', async () => {
    const rows = await dataSource.query<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );
    const tables = rows.map((row) => row.name);

    expect(tables).toEqual(expect.arrayContaining(sources.map((source) => source.table)));
  });

  describe.each(sources)('$table', (source) => {
    let columns: TableInfoRow[];

    beforeAll(async () => {
      columns = await dataSource.query<TableInfoRow[]>(`PRAGMA table_info(${source.table})`);
    });

    it("holds the export's columns, our id and raw_data, and nothing else", () => {
      const expected = ['id', ...source.exportColumns, 'raw_data'].sort();

      expect(columns.map((column) => column.name).sort()).toEqual(expected);
    });

    it('stores every export column as text, parsing nothing', () => {
      const exportAndRaw = columns.filter((column) => column.name !== 'id');

      // `id` is ours and is a generated uuid, which TypeORM declares as varchar
      // on SQLite. Everything that came from the export is text.
      expect(exportAndRaw.map((column) => column.type.toLowerCase())).toEqual(
        exportAndRaw.map(() => 'text'),
      );
      expect(columns.filter((column) => column.pk > 0).map((column) => column.name)).toEqual([
        'id',
      ]);
    });

    it('accepts two rows sharing one legacy id, each with an id of our own', async () => {
      const repository = dataSource.getRepository(source.entity);
      const shared = `recSHARED-${source.table}`;

      const first = await repository.save({
        [source.legacyIdProperty]: shared,
        rawData: 'first occurrence',
      });
      const second = await repository.save({
        [source.legacyIdProperty]: shared,
        rawData: 'second occurrence',
      });

      const stored = await repository.find({ where: { [source.legacyIdProperty]: shared } });

      expect(stored).toHaveLength(2);
      expect(first.id).not.toEqual(second.id);
      expect(first.id).toEqual(expect.any(String));
      expect(second.id).toEqual(expect.any(String));
    });

    it('accepts a row carrying nothing but its legacy id and rawData', async () => {
      const repository = dataSource.getRepository(source.entity);
      const legacyId = `recSPARSE-${source.table}`;

      await repository.save({ [source.legacyIdProperty]: legacyId, rawData: 'sparse row' });

      const stored = await dataSource.query<Record<string, unknown>[]>(
        `SELECT * FROM ${source.table} WHERE ${source.legacyIdColumn} = ?`,
        [legacyId],
      );
      const otherExportColumns = source.exportColumns.filter(
        (column) => column !== source.legacyIdColumn,
      );

      expect(stored).toHaveLength(1);
      expect(otherExportColumns.map((column) => stored[0][column])).toEqual(
        otherExportColumns.map(() => null),
      );
    });

    it('reads rawData back byte for byte', async () => {
      const repository = dataSource.getRepository(source.entity);
      const legacyId = `recRAW-${source.table}`;

      await repository.save({
        [source.legacyIdProperty]: legacyId,
        rawData: source.rawSample,
      });

      const stored = await repository.findOneOrFail({
        where: { [source.legacyIdProperty]: legacyId },
      });

      expect(stored.rawData).toBe(source.rawSample);
    });
  });
});
