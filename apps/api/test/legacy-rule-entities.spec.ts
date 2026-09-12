import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../src/legacy/legacy-rule.entity';
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
}

/** One row of `PRAGMA index_info(<index>)`. */
interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string;
}

interface RuleSource {
  /** The table the entity is expected to create. */
  readonly table: string;
  readonly entity: new () => LegacyRuleRow;
}

const sources: RuleSource[] = [
  { table: 'legacy_patient_rule', entity: LegacyPatientRule },
  { table: 'legacy_intake_rule', entity: LegacyIntakeRule },
  { table: 'legacy_consent_rule', entity: LegacyConsentRule },
];

describe('per-source rule entities', () => {
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

  it('creates all three per-source rule tables by schema sync alone', async () => {
    const rows = await dataSource.query<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );

    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(sources.map((source) => source.table)),
    );
  });

  it('gives the three tables one shape, column for column', async () => {
    const [patient, intake, consent] = await Promise.all(
      sources.map((source) =>
        dataSource.query<TableInfoRow[]>(`PRAGMA table_info(${source.table})`),
      ),
    );

    // Names, declared types, nullability, defaults and key positions, in the
    // same order: the shape is shared, not written out three times.
    expect(intake).toEqual(patient);
    expect(consent).toEqual(patient);
  });

  describe.each(sources)('$table', (source) => {
    let columns: TableInfoRow[];
    let rows: Repository<LegacyRuleRow>;

    beforeAll(async () => {
      columns = await dataSource.query<TableInfoRow[]>(`PRAGMA table_info(${source.table})`);
      rows = dataSource.getRepository(source.entity);
    });

    it('holds the eight fields of the database-structure type and nothing else', () => {
      expect(columns.map((column) => column.name).sort()).toEqual(
        [
          'legacy_id',
          'rule_id',
          'version',
          'column',
          'previous_value',
          'next_value',
          'status',
          'reason',
        ].sort(),
      );
    });

    it('is keyed by (legacy_id, rule_id, version, column), the address of a finding', () => {
      const key = columns
        .filter((column) => column.pk > 0)
        .sort((first, second) => first.pk - second.pk)
        .map((column) => column.name);

      expect(key).toEqual(['legacy_id', 'rule_id', 'version', 'column']);
    });

    it('declares no foreign keys, because a legacy id identifies nothing', async () => {
      const foreignKeys = await dataSource.query<ForeignKeyRow[]>(
        `PRAGMA foreign_key_list(${source.table})`,
      );

      expect(foreignKeys).toEqual([]);
    });

    it('indexes (rule_id, version), which is what the rules screen joins on', async () => {
      const indexes = await dataSource.query<IndexListRow[]>(`PRAGMA index_list(${source.table})`);
      const columnsOf = await Promise.all(
        indexes.map(async (index) => {
          const info = await dataSource.query<IndexInfoRow[]>(`PRAGMA index_info("${index.name}")`);

          return info
            .sort((first, second) => first.seqno - second.seqno)
            .map((entry) => entry.name);
        }),
      );

      expect(columnsOf).toContainEqual(['rule_id', 'version']);
    });

    it('rejects a second finding at the same address', async () => {
      const address = {
        legacyId: `recONCE-${source.table}`,
        ruleId: 'R-PHONE',
        version: 1,
        column: 'phone',
      };

      await rows.insert({ ...address, previousValue: '06 12345678', nextValue: '+31612345678' });

      await expect(
        rows.insert({ ...address, previousValue: '06 12345678', nextValue: '+31612345678' }),
      ).rejects.toThrow();

      expect(await rows.countBy(address)).toBe(1);
    });

    it('keeps a finding from each version of one rule on one column', async () => {
      const address = {
        legacyId: `recVERSIONED-${source.table}`,
        ruleId: 'R-DOB',
        column: 'dob',
      };

      await rows.insert({ ...address, version: 1, previousValue: '01/02/1980', nextValue: null });
      await rows.insert({
        ...address,
        version: 2,
        previousValue: '01/02/1980',
        nextValue: '1980-02-01',
      });

      const stored = await rows.find({ where: address, order: { version: 'ASC' } });

      expect(stored.map((row) => [row.version, row.nextValue])).toEqual([
        [1, null],
        [2, '1980-02-01'],
      ]);
    });

    it('round-trips a finding as (legacy id, column, previousValue, nextValue)', async () => {
      const finding = {
        legacyId: `recROUNDTRIP-${source.table}`,
        ruleId: 'R-CITY',
        version: 7,
        column: 'city',
        previousValue: 'den haag, ZH  ',
        nextValue: "'s-Gravenhage",
      };

      await rows.insert(finding);

      const stored = await rows.findOneOrFail({
        where: {
          legacyId: finding.legacyId,
          ruleId: finding.ruleId,
          version: finding.version,
          column: finding.column,
        },
      });

      expect([stored.legacyId, stored.column, stored.previousValue, stored.nextValue]).toEqual([
        finding.legacyId,
        finding.column,
        finding.previousValue,
        finding.nextValue,
      ]);
    });

    it('accepts an ambiguous finding: a previous value and no next value', async () => {
      const address = {
        legacyId: `recAMBIGUOUS-${source.table}`,
        ruleId: 'R-WEIGHT-UNIT',
        version: 1,
        column: 'weight',
      };

      await rows.insert({ ...address, previousValue: '82', nextValue: null });

      const stored = await rows.findOneOrFail({ where: address });

      expect(stored.previousValue).toBe('82');
      expect(stored.nextValue).toBeNull();
    });

    it('lands a finding in pending when nothing says otherwise', async () => {
      const legacyId = `recPENDING-${source.table}`;

      // Written straight through the driver, with no status column in the
      // statement at all, so it is the schema's default that is under test and
      // not a value TypeORM helpfully supplied. `column` is a SQLite keyword,
      // hence the quotes.
      await dataSource.query(
        `INSERT INTO ${source.table} (legacy_id, rule_id, version, "column", previous_value, next_value)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [legacyId, 'R-PHONE', 1, 'phone', '06 12345678', '+31612345678'],
      );

      const stored = await rows.findOneOrFail({
        where: { legacyId, ruleId: 'R-PHONE', version: 1, column: 'phone' },
      });

      expect(stored.status).toBe('pending');
      expect(stored.reason).toBeNull();
      expect(columns.find((column) => column.name === 'status')?.dflt_value).toBe("'pending'");
    });

    it('stores a finding in each of pending, approved and declined', async () => {
      const statuses = ['pending', 'approved', 'declined'] as const;

      for (const status of statuses) {
        await rows.insert({
          legacyId: `recSTATUS-${status}-${source.table}`,
          ruleId: 'R-EMAIL',
          version: 1,
          column: 'email',
          previousValue: 'a@x',
          nextValue: 'a@x.nl',
          status,
        });
      }

      const stored = await rows.find({
        where: { ruleId: 'R-EMAIL', version: 1, column: 'email' },
        order: { legacyId: 'ASC' },
      });

      expect(stored.map((row) => row.status).sort()).toEqual([...statuses].sort());
    });

    it('stores a declined row with its reason, and one declined without', async () => {
      const withReason = {
        legacyId: `recDECLINED-REASON-${source.table}`,
        ruleId: 'R-BSN',
        version: 1,
        column: 'bsn',
        status: 'declined' as const,
        reason: 'This patient really does have a nine-digit number starting with a zero.',
      };
      const withoutReason = {
        legacyId: `recDECLINED-SILENT-${source.table}`,
        ruleId: 'R-BSN',
        version: 1,
        column: 'bsn',
        status: 'declined' as const,
      };

      await rows.insert(withReason);
      await rows.insert(withoutReason);

      const explained = await rows.findOneOrFail({
        where: { legacyId: withReason.legacyId, ruleId: 'R-BSN', version: 1, column: 'bsn' },
      });
      const silent = await rows.findOneOrFail({
        where: { legacyId: withoutReason.legacyId, ruleId: 'R-BSN', version: 1, column: 'bsn' },
      });

      expect([explained.status, explained.reason]).toEqual(['declined', withReason.reason]);
      expect([silent.status, silent.reason]).toEqual(['declined', null]);
    });
  });

  describe('the legacy id it addresses', () => {
    it('is neither unique nor required to exist, as 1.0.3 makes it', async () => {
      const patients = dataSource.getRepository(LegacyPatient);
      const rules = dataSource.getRepository(LegacyPatientRule);
      const shared = 'recSHARED-BY-TWO-PATIENTS';

      await patients.save({ legacyPatientId: shared, rawData: 'first occurrence' });
      await patients.save({ legacyPatientId: shared, rawData: 'second occurrence' });

      // Two findings naming the one legacy id that two legacy rows share, plus
      // one naming a legacy id no legacy row carries. Nothing in the schema may
      // reject any of them.
      await rules.insert({
        legacyId: shared,
        ruleId: 'R-PHONE',
        version: 1,
        column: 'phone',
        previousValue: '06 12345678',
        nextValue: '+31612345678',
      });
      await rules.insert({
        legacyId: shared,
        ruleId: 'R-CITY',
        version: 1,
        column: 'city',
        previousValue: 'den haag',
        nextValue: 'Den Haag',
      });
      await rules.insert({
        legacyId: 'recNO-SUCH-PATIENT',
        ruleId: 'R-PHONE',
        version: 1,
        column: 'phone',
        previousValue: '06 12345678',
        nextValue: '+31612345678',
      });

      expect(await patients.countBy({ legacyPatientId: shared })).toBe(2);
      expect(await rules.countBy({ legacyId: shared })).toBe(2);
      expect(await rules.countBy({ legacyId: 'recNO-SUCH-PATIENT' })).toBe(1);
    });
  });
});
