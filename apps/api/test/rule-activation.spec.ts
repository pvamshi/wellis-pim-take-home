import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService, UnknownRuleVersionError } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

describe('activating a rule version', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let service: RuleVersionsService;

  /** The whole point of the write path: how many versions of a rule are active. */
  async function activeVersionsOf(ruleId: string): Promise<number[]> {
    const active = await versions.find({
      where: { ruleId, status: 'active' },
      order: { version: 'ASC' },
    });

    return active.map((version) => version.version);
  }

  async function seedRule(ruleId: string, versionNumbers: number[]): Promise<void> {
    await rules.save({
      ruleId,
      ruleName: `${ruleId} name`,
      description: `${ruleId} description`,
      ambiguous: false,
    });

    for (const version of versionNumbers) {
      await versions.insert({ ruleId, version });
    }
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = moduleRef.get(DataSource);
    rules = dataSource.getRepository(Rule);
    versions = dataSource.getRepository(RuleVersion);
    service = moduleRef.get(RuleVersionsService);
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

  it('deactivates the version it supersedes, leaving exactly one active', async () => {
    await seedRule('R-SUPERSEDE', [1, 2]);
    await service.activate('R-SUPERSEDE', 1);

    await service.activate('R-SUPERSEDE', 2);

    const first = await versions.findOneOrFail({ where: { ruleId: 'R-SUPERSEDE', version: 1 } });
    const second = await versions.findOneOrFail({ where: { ruleId: 'R-SUPERSEDE', version: 2 } });

    expect(second.status).toBe('active');
    expect(first.status).toBe('inactive');
    expect(await activeVersionsOf('R-SUPERSEDE')).toEqual([2]);
  });

  it('keeps the superseded version, with its review state untouched', async () => {
    await seedRule('R-KEPT', [1, 2]);
    await service.activate('R-KEPT', 1);
    // The shape 1.2.6 leaves behind: a declined version sitting in the revision
    // queue, which 1.5.1 is what clears — not activating its replacement.
    await versions.update(
      { ruleId: 'R-KEPT', version: 1 },
      { needsReview: true, reason: 'It matched rows it should not have.' },
    );

    await service.activate('R-KEPT', 2);

    const superseded = await versions.findOne({ where: { ruleId: 'R-KEPT', version: 1 } });

    expect(superseded).not.toBeNull();
    expect(superseded?.status).toBe('inactive');
    expect(superseded?.needsReview).toBe(true);
    expect(superseded?.reason).toBe('It matched rows it should not have.');
  });

  it('leaves the active version of another rule alone', async () => {
    await seedRule('R-LEFT', [1]);
    await seedRule('R-RIGHT', [1, 2]);
    await service.activate('R-LEFT', 1);
    await service.activate('R-RIGHT', 1);

    await service.activate('R-RIGHT', 2);

    expect(await activeVersionsOf('R-LEFT')).toEqual([1]);
    expect(await activeVersionsOf('R-RIGHT')).toEqual([2]);
  });

  it('is idempotent on the version that is already active', async () => {
    await seedRule('R-IDEMPOTENT', [1, 2]);
    await service.activate('R-IDEMPOTENT', 2);

    await service.activate('R-IDEMPOTENT', 2);

    expect(await activeVersionsOf('R-IDEMPOTENT')).toEqual([2]);
  });

  it('throws on an unknown version and leaves the active one as it was', async () => {
    await seedRule('R-TYPO', [1]);
    await service.activate('R-TYPO', 1);

    await expect(service.activate('R-TYPO', 9)).rejects.toBeInstanceOf(UnknownRuleVersionError);

    expect(await activeVersionsOf('R-TYPO')).toEqual([1]);
  });

  it('throws on a version of a rule that does not exist at all', async () => {
    await expect(service.activate('R-ABSENT', 1)).rejects.toBeInstanceOf(UnknownRuleVersionError);
  });

  it('refuses a second active version written straight through a repository', async () => {
    await seedRule('R-DIRECT', [1, 2]);
    await service.activate('R-DIRECT', 1);

    await expect(
      versions.update({ ruleId: 'R-DIRECT', version: 2 }, { status: 'active' }),
    ).rejects.toThrow();

    expect(await activeVersionsOf('R-DIRECT')).toEqual([1]);
  });
});
