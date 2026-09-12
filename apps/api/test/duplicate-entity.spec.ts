import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/** The link as it is actually stored, read column by column. */
interface StoredLinkRow {
  source_table: string;
  duplicate_legacy_id: string;
  canonical_legacy_id: string;
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

  it('holds the six fields of the database-structure type and nothing else', () => {
    expect(columns.map((column) => column.name).sort()).toEqual(
      [
        'id',
        'source_table',
        'duplicate_legacy_id',
        'canonical_legacy_id',
        'rule_id',
        'version',
      ].sort(),
    );
  });

  it('is keyed by id alone, because neither legacy id identifies a row', () => {
    expect(columns.filter((column) => column.pk > 0).map((column) => column.name)).toEqual(['id']);
  });

  it('fills the id in itself, so the link has an identity of ours', async () => {
    const stored = await duplicates.save({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-GENERATED-X',
      canonicalLegacyId: 'P-GENERATED-Y',
      ruleId: 'R-DUP-GENERATED',
      version: 1,
    });

    expect(stored.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // That id is the one the row is stored under, not a value the entity kept
    // to itself: it is read back out of the table's own `id` column.
    const rows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM duplicate WHERE rule_id = ?`,
      ['R-DUP-GENERATED'],
    );

    expect(rows.map((row) => row.id)).toEqual([stored.id]);
  });

  it('requires every one of the six columns', () => {
    expect(columns.map((column) => [column.name, column.notnull])).toEqual(
      columns.map((column) => [column.name, 1]),
    );
  });

  it('rejects a half-recorded link with no canonical id', async () => {
    // Written straight through the driver, with the column absent from the
    // statement, so it is the schema that rejects it and not TypeORM.
    await expect(
      dataSource.query(
        `INSERT INTO duplicate (id, source_table, duplicate_legacy_id, rule_id, version)
         VALUES (?, ?, ?, ?, ?)`,
        ['half-recorded', 'patient', 'P-450', 'R-DUP-HALF', 1],
      ),
    ).rejects.toThrow();

    expect(await duplicates.countBy({ id: 'half-recorded' })).toBe(0);
  });

  it('declares no foreign keys, because a legacy id identifies nothing', async () => {
    const foreignKeys = await dataSource.query<ForeignKeyRow[]>(
      `PRAGMA foreign_key_list(duplicate)`,
    );

    expect(foreignKeys).toEqual([]);
  });

  it('records X as the duplicate and Y as the one that survives', async () => {
    await duplicates.save({
      sourceTable: 'patient',
      duplicateLegacyId: 'P-450',
      canonicalLegacyId: 'P-100',
      ruleId: 'R-DUP',
      version: 1,
    });

    // Read out of the columns themselves, not back through the entity that
    // wrote them: a mapping with the two names swapped round-trips through
    // itself undetected, and the direction is the whole of what 1.1.13 records.
    const rows = await dataSource.query<StoredLinkRow[]>(
      `SELECT source_table, duplicate_legacy_id, canonical_legacy_id
       FROM duplicate WHERE rule_id = ? AND version = ?`,
      ['R-DUP', 1],
    );

    expect(rows).toEqual([
      {
        source_table: 'patient',
        duplicate_legacy_id: 'P-450',
        canonical_legacy_id: 'P-100',
      },
    ]);
  });

  it('serves all three sources from the one table', async () => {
    const sources: DuplicateSourceTable[] = ['patient', 'intake', 'consent'];

    for (const sourceTable of sources) {
      await duplicates.save({
        sourceTable,
        duplicateLegacyId: `${sourceTable}-X`,
        canonicalLegacyId: `${sourceTable}-Y`,
        ruleId: 'R-DUP-ALL-SOURCES',
        version: 1,
      });
    }

    const rows = await dataSource.query<StoredLinkRow[]>(
      `SELECT source_table, duplicate_legacy_id, canonical_legacy_id
       FROM duplicate WHERE rule_id = ? ORDER BY source_table`,
      ['R-DUP-ALL-SOURCES'],
    );

    expect(rows).toEqual([
      {
        source_table: 'consent',
        duplicate_legacy_id: 'consent-X',
        canonical_legacy_id: 'consent-Y',
      },
      {
        source_table: 'intake',
        duplicate_legacy_id: 'intake-X',
        canonical_legacy_id: 'intake-Y',
      },
      {
        source_table: 'patient',
        duplicate_legacy_id: 'patient-X',
        canonical_legacy_id: 'patient-Y',
      },
    ]);
  });

  it('retires nothing: the link carries no status of its own', () => {
    // D5 stays unbuilt. There is nowhere on this row to mark X retired, so
    // recording the link cannot be mistaken for retiring anything.
    expect(columns.map((column) => column.name)).not.toContain('status');
    expect(columns.map((column) => column.name)).not.toContain('retired');
  });
});
