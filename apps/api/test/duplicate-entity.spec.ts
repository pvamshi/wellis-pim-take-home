import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { Duplicate, type DuplicateSourceTable } from '../src/duplicates/duplicate.entity';
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

/** One row of `PRAGMA index_list(<table>)`. */
interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

/** One row of `PRAGMA index_info(<index>)`. */
interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string;
}

/** The link as it is actually stored, read column by column. */
interface StoredLinkRow {
  source_table: string;
  duplicate_legacy_id: string;
  duplicate_row_id: string;
  canonical_legacy_id: string;
  canonical_row_id: string;
}

/** A minimal, valid link — every NOT NULL column filled, unless a test overrides one. */
function baseLink(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    sourceTable: 'patient',
    duplicateLegacyId: 'P-450',
    duplicateRowId: 'row-450',
    canonicalLegacyId: 'P-100',
    canonicalRowId: 'row-100',
    ruleId: 'R-DUP',
    version: 1,
    ...overrides,
  };
}

describe('duplicate entity', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let duplicates: Repository<Duplicate>;
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
    duplicates = dataSource.getRepository(Duplicate);
    columns = await dataSource.query<TableInfoRow[]>(`PRAGMA table_info(duplicate)`);
  });

  // The unique index (1.7.1, 1.7.2) is new: unlike the original six-column
  // table, a triple one test writes can now collide with one an earlier test
  // left behind. Each test is given a table with nothing in it, the same
  // isolation every other spec file's `beforeEach` already gives its own
  // tables.
  beforeEach(async () => {
    await dataSource.query(`DELETE FROM duplicate`);
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

  it('creates the duplicate table by schema sync alone', async () => {
    const rows = await dataSource.query<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['duplicate']));
  });

  it('holds the nine fields of 1.7.1 and nothing else', () => {
    expect(columns.map((column) => column.name).sort()).toEqual(
      [
        'id',
        'source_table',
        'duplicate_legacy_id',
        'duplicate_row_id',
        'canonical_legacy_id',
        'canonical_row_id',
        'rule_id',
        'version',
        'status',
      ].sort(),
    );
  });

  it('is keyed by id alone, because neither legacy id identifies a row', () => {
    expect(columns.filter((column) => column.pk > 0).map((column) => column.name)).toEqual(['id']);
  });

  it('fills the id in itself, so the link has an identity of ours', async () => {
    const stored = await duplicates.save(baseLink({ ruleId: 'R-DUP-GENERATED' }));

    expect(stored.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // That id is the one the row is stored under, not a value the entity kept
    // to itself: it is read back out of the table's own `id` column.
    const rows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM duplicate WHERE rule_id = ?`,
      ['R-DUP-GENERATED'],
    );

    expect(rows.map((row) => row.id)).toEqual([stored.id]);
  });

  it('defaults status to pending, without the write path having to say so', async () => {
    // Written straight through the driver, `status` absent from the
    // statement, so it is the column default answering and not TypeORM's own
    // insert defaulting.
    await dataSource.query(
      `INSERT INTO duplicate
         (id, source_table, duplicate_legacy_id, duplicate_row_id, canonical_legacy_id, canonical_row_id, rule_id, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['status-default', 'patient', 'P-1', 'row-1', 'P-2', 'row-2', 'R-DUP-DEFAULT', 1],
    );

    const rows = await dataSource.query<{ status: string }[]>(
      `SELECT status FROM duplicate WHERE id = ?`,
      ['status-default'],
    );

    expect(rows).toEqual([{ status: 'pending' }]);
  });

  it('declares every one of the nine columns NOT NULL', () => {
    // `id` and `status` are NOT NULL too, same as every column here — they are
    // just never left to the database to fill: `save` below generates `id`
    // itself, and `RuleFindingsService.persist` (1.7.2) always sets `status`
    // rather than leaning on the column default (`defaults status to pending`
    // above proves the default exists; this proves it is never required to).
    expect(columns.map((column) => [column.name, column.notnull])).toEqual(
      columns.map((column) => [column.name, 1]),
    );
  });

  it('rejects a half-recorded link with no canonical row id', async () => {
    // Written straight through the driver, with the column absent from the
    // statement, so it is the schema that rejects it and not TypeORM. Every
    // other required column is filled, so this isolates the one column the
    // test claims to be about.
    await expect(
      dataSource.query(
        `INSERT INTO duplicate
           (id, source_table, duplicate_legacy_id, duplicate_row_id, canonical_legacy_id, rule_id, version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['half-recorded', 'patient', 'P-450', 'row-450', 'P-100', 'R-DUP-HALF', 1],
      ),
    ).rejects.toThrow();

    expect(await duplicates.countBy({ id: 'half-recorded' })).toBe(0);
  });

  it('declares no foreign keys, because a legacy id identifies nothing and a row id points at no single table', async () => {
    const foreignKeys = await dataSource.query<ForeignKeyRow[]>(
      `PRAGMA foreign_key_list(duplicate)`,
    );

    expect(foreignKeys).toEqual([]);
  });

  it('records X as the duplicate and Y as the one that survives, both legacy id and row', async () => {
    await duplicates.save(baseLink());

    // Read out of the columns themselves, not back through the entity that
    // wrote them: a mapping with the two sides swapped round-trips through
    // itself undetected, and the direction is the whole of what 1.1.13 records.
    const rows = await dataSource.query<StoredLinkRow[]>(
      `SELECT source_table, duplicate_legacy_id, duplicate_row_id, canonical_legacy_id, canonical_row_id
       FROM duplicate WHERE rule_id = ? AND version = ?`,
      ['R-DUP', 1],
    );

    expect(rows).toEqual([
      {
        source_table: 'patient',
        duplicate_legacy_id: 'P-450',
        duplicate_row_id: 'row-450',
        canonical_legacy_id: 'P-100',
        canonical_row_id: 'row-100',
      },
    ]);
  });

  it('serves all three sources from the one table', async () => {
    const sources: DuplicateSourceTable[] = ['patient', 'intake', 'consent'];

    for (const sourceTable of sources) {
      await duplicates.save(
        baseLink({
          sourceTable,
          duplicateLegacyId: `${sourceTable}-X`,
          duplicateRowId: `${sourceTable}-row-X`,
          canonicalLegacyId: `${sourceTable}-Y`,
          canonicalRowId: `${sourceTable}-row-Y`,
          ruleId: 'R-DUP-ALL-SOURCES',
        }),
      );
    }

    const rows = await dataSource.query<StoredLinkRow[]>(
      `SELECT source_table, duplicate_legacy_id, duplicate_row_id, canonical_legacy_id, canonical_row_id
       FROM duplicate WHERE rule_id = ? ORDER BY source_table`,
      ['R-DUP-ALL-SOURCES'],
    );

    expect(rows).toEqual([
      {
        source_table: 'consent',
        duplicate_legacy_id: 'consent-X',
        duplicate_row_id: 'consent-row-X',
        canonical_legacy_id: 'consent-Y',
        canonical_row_id: 'consent-row-Y',
      },
      {
        source_table: 'intake',
        duplicate_legacy_id: 'intake-X',
        duplicate_row_id: 'intake-row-X',
        canonical_legacy_id: 'intake-Y',
        canonical_row_id: 'intake-row-Y',
      },
      {
        source_table: 'patient',
        duplicate_legacy_id: 'patient-X',
        duplicate_row_id: 'patient-row-X',
        canonical_legacy_id: 'patient-Y',
        canonical_row_id: 'patient-row-Y',
      },
    ]);
  });

  it('carries a status that moves pending to confirmed or dismissed, and nothing beyond it (1.7.3)', async () => {
    const confirmed = await duplicates.save(
      baseLink({
        ruleId: 'R-DUP-CONFIRMED',
        duplicateRowId: 'row-status-confirmed-x',
        canonicalRowId: 'row-status-confirmed-y',
        status: 'confirmed',
      }),
    );
    const dismissed = await duplicates.save(
      baseLink({
        ruleId: 'R-DUP-DISMISSED',
        duplicateRowId: 'row-status-dismissed-x',
        canonicalRowId: 'row-status-dismissed-y',
        status: 'dismissed',
      }),
    );

    expect(
      await dataSource.query<{ status: string }[]>(
        `SELECT status FROM duplicate WHERE id IN (?, ?)`,
        [confirmed.id, dismissed.id],
      ),
    ).toEqual(expect.arrayContaining([{ status: 'confirmed' }, { status: 'dismissed' }]));

    // D5 (retiring X) still stays unbuilt: this status names the link's own
    // decision, and there is nowhere on this row that names X retired.
    expect(columns.map((column) => column.name)).not.toContain('retired');
  });

  it('rejects a repeated (sourceTable, duplicateRowId, canonicalRowId) at the schema level', async () => {
    await dataSource.query(
      `INSERT INTO duplicate
         (id, source_table, duplicate_legacy_id, duplicate_row_id, canonical_legacy_id, canonical_row_id, rule_id, version, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['uq-first', 'patient', 'P-450', 'row-450', 'P-100', 'row-100', 'R-DUP-UQ-A', 1, 'pending'],
    );

    // Same pair, same source, a different rule and a different status — the
    // index does not care: it is keyed on the triple alone (1.7.2).
    await expect(
      dataSource.query(
        `INSERT INTO duplicate
           (id, source_table, duplicate_legacy_id, duplicate_row_id, canonical_legacy_id, canonical_row_id, rule_id, version, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'uq-second',
          'patient',
          'P-450',
          'row-450',
          'P-100',
          'row-100',
          'R-DUP-UQ-B',
          1,
          'dismissed',
        ],
      ),
    ).rejects.toThrow();

    expect(await duplicates.countBy({ id: 'uq-second' })).toBe(0);
    expect(await duplicates.countBy({ id: 'uq-first' })).toBe(1);
  });

  it('lets the same row ids repeat under a different source table', async () => {
    // The index is scoped by source: two different legacy sources using the
    // same row id text is not the same pair.
    await duplicates.save(
      baseLink({
        sourceTable: 'patient',
        duplicateRowId: 'shared-row-x',
        canonicalRowId: 'shared-row-y',
        ruleId: 'R-DUP-SCOPE-A',
      }),
    );

    await expect(
      duplicates.save(
        baseLink({
          sourceTable: 'intake',
          duplicateRowId: 'shared-row-x',
          canonicalRowId: 'shared-row-y',
          ruleId: 'R-DUP-SCOPE-B',
        }),
      ),
    ).resolves.toBeDefined();

    expect(await duplicates.countBy({ duplicateRowId: 'shared-row-x' })).toBe(2);
  });

  it('declares the unique index on the ordered triple, and nothing broader', async () => {
    const indexes = await dataSource.query<IndexListRow[]>(`PRAGMA index_list(duplicate)`);
    const unique = indexes.filter((index) => index.unique === 1 && index.origin !== 'pk');

    expect(unique).toHaveLength(1);

    const columnsOfIndex = await dataSource.query<IndexInfoRow[]>(
      `PRAGMA index_info(${unique[0]?.name})`,
    );

    expect(columnsOfIndex.map((column) => column.name)).toEqual([
      'source_table',
      'duplicate_row_id',
      'canonical_row_id',
    ]);
  });
});
