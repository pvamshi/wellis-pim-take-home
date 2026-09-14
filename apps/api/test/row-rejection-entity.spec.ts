import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { RowRejection } from '../src/rows/row-rejection.entity';
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
  /** 0 for a non-key column, otherwise the column's 1-based place in the key. */
  pk: number;
}

/** One row of `PRAGMA foreign_key_list(<table>)`. */
interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
}

/** The rejection as it is actually stored, read column by column. */
interface StoredRejectionRow {
  source_table: string;
  legacy_id: string;
  reason: string | null;
}

describe('row rejection entity', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let rejections: Repository<RowRejection>;
  let columns: TableInfoRow[];

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
    rejections = dataSource.getRepository(RowRejection);
    columns = await dataSource.query<TableInfoRow[]>(`PRAGMA table_info(row_rejection)`);
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

  it('creates the row_rejection table by schema sync alone', async () => {
    const rows = await dataSource.query<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['row_rejection']));
  });

  it('holds exactly the three columns 1.6.2 asks for', () => {
    expect(columns.map((column) => column.name).sort()).toEqual(
      ['source_table', 'legacy_id', 'reason'].sort(),
    );
  });

  it('is keyed by (source_table, legacy_id), with source_table leading', () => {
    const keyColumns = columns
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name);

    // Order matters here, not just membership: the plan puts `source_table`
    // first so the composite index's leading column matches the one query
    // this screen runs (every rejection for one source).
    expect(keyColumns).toEqual(['source_table', 'legacy_id']);
  });

  it('requires source_table and legacy_id, but not reason', () => {
    const required = columns
      .filter((column) => column.name !== 'reason')
      .map((column) => column.notnull);
    const reason = columns.find((column) => column.name === 'reason');

    expect(required).toEqual(required.map(() => 1));
    expect(reason?.notnull).toBe(0);
  });

  it('rejects a rejection with no legacy_id', async () => {
    // Written straight through the driver, with the column absent from the
    // statement, so it is the schema that rejects it and not TypeORM.
    await expect(
      dataSource.query(`INSERT INTO row_rejection (source_table, reason) VALUES (?, ?)`, [
        'patient',
        'beyond repair',
      ]),
    ).rejects.toThrow();

    expect(await rejections.countBy({ table: 'patient' })).toBe(0);
  });

  it('declares no foreign keys, because a legacy id identifies nothing', async () => {
    const foreignKeys = await dataSource.query<ForeignKeyRow[]>(
      `PRAGMA foreign_key_list(row_rejection)`,
    );

    expect(foreignKeys).toEqual([]);
  });

  it('stores the source, the legacy id and the reason', async () => {
    await rejections.save({ table: 'patient', legacyId: 'P-0781', reason: 'beyond repair' });

    // Read out of the columns themselves, not back through the entity that
    // wrote them.
    const rows = await dataSource.query<StoredRejectionRow[]>(
      `SELECT source_table, legacy_id, reason FROM row_rejection WHERE legacy_id = ?`,
      ['P-0781'],
    );

    expect(rows).toEqual([
      { source_table: 'patient', legacy_id: 'P-0781', reason: 'beyond repair' },
    ]);
  });

  it('stores a rejection with no reason at all (1.6.6 shows a reason, never requires one)', async () => {
    await rejections.save({ table: 'intake', legacyId: 'I-9001', reason: null });

    const rows = await dataSource.query<StoredRejectionRow[]>(
      `SELECT source_table, legacy_id, reason FROM row_rejection WHERE legacy_id = ?`,
      ['I-9001'],
    );

    expect(rows).toEqual([{ source_table: 'intake', legacy_id: 'I-9001', reason: null }]);
  });

  it('serves all three sources from the one table', async () => {
    await rejections.save({ table: 'consent', legacyId: 'C-1', reason: null });

    const rows = await dataSource.query<{ source_table: string }[]>(
      `SELECT source_table FROM row_rejection WHERE legacy_id = ?`,
      ['C-1'],
    );

    expect(rows).toEqual([{ source_table: 'consent' }]);
  });

  it('has no status or active column: presence of the row is the fact', () => {
    // The same line `duplicate-entity.spec.ts` draws for `Duplicate`: reversing
    // a rejection is a future DELETE, not a flag flip, so no column is needed
    // for it here.
    expect(columns.map((column) => column.name)).not.toContain('status');
    expect(columns.map((column) => column.name)).not.toContain('active');
  });
});
