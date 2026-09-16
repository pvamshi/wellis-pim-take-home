import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import type { DeclineResponse } from '../src/decline/decline.controller';
import type { RuleDetailResponse } from '../src/rule-detail/rule-detail.controller';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * Guidance given to a rule (1.5.1), over HTTP and against a real database.
 *
 * The press says what a rule should do instead. It parks the rule's active
 * version with that sentence stored on it — the queue the revision workflow
 * reads — and touches no rule row, so nothing here seeds a finding.
 *
 * Each test uses a rule id of its own, so no test's version can be parked by
 * another's press.
 */
describe('guidance for a rule, sent to be rewritten', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let ruleVersions: RuleVersionsService;

  /** A rule with its versions, and one of them active (1.1.8). */
  async function seedRule(ruleId: string, versionNumbers: number[], active?: number): Promise<void> {
    await rules.save({
      ruleId,
      ruleName: `${ruleId} name`,
      description: `${ruleId} description`,
      ambiguous: true,
    });

    for (const version of versionNumbers) {
      await versions.insert({ ruleId, version });
    }

    if (active !== undefined) {
      await ruleVersions.activate(ruleId, active);
    }
  }

  async function revise(
    ruleId: string,
    body: unknown,
  ): Promise<{ status: number; body: DeclineResponse }> {
    const response = await request(app.getHttpServer())
      .post(`/rules/${ruleId}/revise`)
      .send(body as object);

    return { status: response.status, body: response.body as DeclineResponse };
  }

  /** What the screen reads back after the press. */
  async function detail(ruleId: string): Promise<RuleDetailResponse> {
    const response = await request(app.getHttpServer()).get(`/rules/${ruleId}`);

    return response.body as RuleDetailResponse;
  }

  async function storedVersion(ruleId: string, version: number): Promise<RuleVersion> {
    const row = await versions.findOneBy({ ruleId, version });

    if (row === null) {
      throw new Error(`no ${ruleId} v${version}`);
    }

    return row;
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    dataSource = moduleRef.get(DataSource);
    rules = dataSource.getRepository(Rule);
    versions = dataSource.getRepository(RuleVersion);
    ruleVersions = moduleRef.get(RuleVersionsService);
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

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM rule_version`);
    await dataSource.query(`DELETE FROM rule`);
  });

  it('parks the active version with the guidance stored on it', async () => {
    await seedRule('R-GUIDE', [1], 1);

    const { status, body } = await revise('R-GUIDE', {
      guidance: '  an empty unit is not always kilograms — decide it by the weight  ',
    });

    // 200, and the padding is gone: the guidance is a sentence, not a form.
    expect(status).toBe(200);
    expect(body).toEqual({
      ruleId: 'R-GUIDE',
      version: 1,
      reason: 'an empty unit is not always kilograms — decide it by the weight',
    });

    // The queue the revision workflow reads is these three fields (1.5.1).
    expect(await storedVersion('R-GUIDE', 1)).toMatchObject({
      status: 'inactive',
      needsReview: true,
      reason: 'an empty unit is not always kilograms — decide it by the weight',
    });
  });

  it('shows the guidance back, and a second press refines it on the version already waiting', async () => {
    await seedRule('R-AGAIN', [1], 1);

    await revise('R-AGAIN', { guidance: 'decide it by the weight' });

    const waiting = await detail('R-AGAIN');

    // The box on screen opens holding this, so it is edited rather than
    // remembered — and the rule says it is already waiting.
    expect(waiting).toMatchObject({
      version: null,
      guidance: 'decide it by the weight',
      guidanceVersion: 1,
      queuedForRevision: true,
    });

    const second = await revise('R-AGAIN', { guidance: 'decide it by the weight and the height' });

    // No active version is left to park, so the sentence replaces the one on
    // the version already queued rather than doing nothing.
    expect(second.body).toEqual({
      ruleId: 'R-AGAIN',
      version: 1,
      reason: 'decide it by the weight and the height',
    });
    expect((await detail('R-AGAIN')).guidance).toBe('decide it by the weight and the height');
    expect(await storedVersion('R-AGAIN', 1)).toMatchObject({ needsReview: true });
  });

  it('is a 400 with nothing to rewrite from, and parks nothing', async () => {
    await seedRule('R-EMPTY', [1], 1);

    const missing = await revise('R-EMPTY', {});
    const blank = await revise('R-EMPTY', { guidance: '   ' });
    const wrongType = await revise('R-EMPTY', { guidance: 7 });

    // Unlike a decline, this press exists to carry a sentence: an empty one
    // would queue a revision with nothing in it.
    expect([missing.status, blank.status, wrongType.status]).toEqual([400, 400, 400]);
    expect(await storedVersion('R-EMPTY', 1)).toMatchObject({
      status: 'active',
      needsReview: false,
      reason: null,
    });
  });

  it('writes nothing for a rule with no version to send', async () => {
    const { status, body } = await revise('R-NOBODY', { guidance: 'anything at all' });

    // A press with nothing to act on is a report, not a fault (1.2.12).
    expect(status).toBe(200);
    expect(body).toEqual({ ruleId: 'R-NOBODY', version: null, reason: null });
  });
});
