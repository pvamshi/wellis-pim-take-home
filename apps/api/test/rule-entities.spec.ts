import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/** One row of `PRAGMA table_info(<table>)`. SQLite's own column names. */
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

describe('rule and rule_version entities', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;

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
    rules = dataSource.getRepository(Rule);
    versions = dataSource.getRepository(RuleVersion);
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

  it('creates both rules tables by schema sync alone', async () => {
    const rows = await dataSource.query<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    );

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(['rule', 'rule_version']));
  });

  describe('rule', () => {
    let columns: TableInfoRow[];

    beforeAll(async () => {
      columns = await dataSource.query<TableInfoRow[]>(`PRAGMA table_info(rule)`);
    });

    it('holds the four fields of the database-structure type and nothing else', () => {
      expect(columns.map((column) => column.name).sort()).toEqual(
        ['ambiguous', 'description', 'rule_id', 'rule_name'].sort(),
      );
    });

    it('is keyed by rule_id alone, the id rule code is written against', () => {
      expect(columns.filter((column) => column.pk > 0).map((column) => column.name)).toEqual([
        'rule_id',
      ]);
    });

    it('requires the author to state ambiguous rather than defaulting it', () => {
      const ambiguous = columns.find((column) => column.name === 'ambiguous');

      expect(ambiguous?.notnull).toBe(1);
      expect(ambiguous?.dflt_value).toBeNull();
    });

    it('reads ambiguous back as a boolean, both ways round', async () => {
      await rules.save({
        ruleId: 'R-AMBIGUOUS',
        ruleName: 'Weight has no unit',
        description: 'The weight column has no unit and cannot be guessed.',
        ambiguous: true,
      });
      await rules.save({
        ruleId: 'R-FIXABLE',
        ruleName: 'Phone format',
        description: 'Rewrites a phone number into E.164.',
        ambiguous: false,
      });

      const stored = await rules.find({ order: { ruleId: 'ASC' } });

      expect(stored.map((rule) => [rule.ruleId, rule.ambiguous])).toEqual([
        ['R-AMBIGUOUS', true],
        ['R-FIXABLE', false],
      ]);
    });
  });

  describe('rule_version', () => {
    let columns: TableInfoRow[];

    beforeAll(async () => {
      columns = await dataSource.query<TableInfoRow[]>(`PRAGMA table_info(rule_version)`);

      await rules.save({
        ruleId: 'R-VERSIONED',
        ruleName: 'Signup date format',
        description: 'Normalises signup_date to ISO.',
        ambiguous: false,
      });
    });

    it('holds the five fields of the database-structure type and nothing else', () => {
      expect(columns.map((column) => column.name).sort()).toEqual(
        ['needs_review', 'reason', 'rule_id', 'status', 'version'].sort(),
      );
    });

    it('is keyed by (rule_id, version), the key the code is written against', () => {
      const key = columns
        .filter((column) => column.pk > 0)
        .sort((first, second) => first.pk - second.pk)
        .map((column) => column.name);

      expect(key).toEqual(['rule_id', 'version']);
    });

    it('declares rule_id a foreign key to rule, so a version cannot orphan', async () => {
      const foreignKeys = await dataSource.query<ForeignKeyRow[]>(
        `PRAGMA foreign_key_list(rule_version)`,
      );

      expect(foreignKeys.map((key) => [key.table, key.from, key.to])).toEqual([
        ['rule', 'rule_id', 'rule_id'],
      ]);
    });

    it('lands inactive when nothing says otherwise', async () => {
      await versions.insert({ ruleId: 'R-VERSIONED', version: 1 });

      const stored = await versions.findOneOrFail({
        where: { ruleId: 'R-VERSIONED', version: 1 },
      });

      expect(stored.status).toBe('inactive');
      expect(stored.needsReview).toBe(false);
      expect(stored.reason).toBeNull();
    });

    it('stores a declined version with its reason, and one without a reason', async () => {
      await versions.insert({
        ruleId: 'R-VERSIONED',
        version: 2,
        needsReview: true,
        reason: 'It rewrote dates that were already correct.',
      });
      await versions.insert({ ruleId: 'R-VERSIONED', version: 3, needsReview: true });

      const withReason = await versions.findOneOrFail({
        where: { ruleId: 'R-VERSIONED', version: 2 },
      });
      const withoutReason = await versions.findOneOrFail({
        where: { ruleId: 'R-VERSIONED', version: 3 },
      });

      expect(withReason.needsReview).toBe(true);
      expect(withReason.reason).toBe('It rewrote dates that were already correct.');
      expect(withoutReason.needsReview).toBe(true);
      expect(withoutReason.reason).toBeNull();
    });
  });
});
