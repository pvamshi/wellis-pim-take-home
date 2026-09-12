import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatientRule } from '../src/legacy/legacy-rule.entity';
import type { RegisteredRule, RuleFunction } from '../src/rules/rule-contract';
import { RuleRegistry, UnregisteredRuleError } from '../src/rules/rule-registry';
import {
  InvalidRevisionError,
  NotQueuedForRevisionError,
  RuleRevisionsService,
  type QueuedRevision,
} from '../src/rules/rule-revisions.service';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService, UnknownRuleVersionError } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The revision workflow's read of the queue and its one write (1.5.1, 1.5.2),
 * against a real database.
 *
 * `needsReview` is the queue, and it is filled the way the requirements fill
 * it: every version this suite revises was declined through
 * `RuleVersionsService.decline`, which is what both presses behind the cross
 * call (1.2.6, 1.2.8). Nothing sets the flag by hand, so a decline that stopped
 * writing it would fail here too.
 *
 * Fake rules, because this body of work is the infrastructure rules run on and
 * not the rules; the catalogue ships empty on purpose and the registry is
 * overridden with the keys these tests revise into, which is the wiring real
 * rules will arrive through. `R-NOCODE` version 3 is deliberately absent from
 * it — an active version with no code aborts the next run (1.1.14), so refusing
 * to write one is a behaviour with a test of its own.
 *
 * Every test uses rule ids of its own, so one test's queue entry is never
 * another's.
 */

/**
 * A rule that finds nothing.
 *
 * Never called: the registry is consulted here for whether a key has code
 * (1.1.1), which is what the revision checks before it writes a version it is
 * about to activate. What the code does is `rule-runner.spec.ts`'s subject.
 */
const findsNothing: RuleFunction = async () => ({ ambiguity: false, updates: [] });

/** Every key these tests revise into. `R-NOCODE` version 3 is not one. */
const fakeRules: RegisteredRule[] = [
  { ruleId: 'R-NEXT', version: 2, run: findsNothing },
  { ruleId: 'R-KEEP', version: 2, run: findsNothing },
  { ruleId: 'R-PAIR-A', version: 2, run: findsNothing },
  { ruleId: 'R-SPLIT', version: 2, run: findsNothing },
  { ruleId: 'R-SPLIT-NEW', version: 1, run: findsNothing },
  { ruleId: 'R-PARK', version: 2, run: findsNothing },
  { ruleId: 'R-PARK-NEW', version: 1, run: findsNothing },
  { ruleId: 'R-ONEACTIVE', version: 3, run: findsNothing },
  { ruleId: 'R-RENUMBER', version: 1, run: findsNothing },
  { ruleId: 'R-RENUMBER', version: 2, run: findsNothing },
  { ruleId: 'R-NOTQUEUED', version: 2, run: findsNothing },
  { ruleId: 'R-ABSENT', version: 2, run: findsNothing },
  { ruleId: 'R-ROLLBACK', version: 3, run: findsNothing },
  { ruleId: 'R-TAKEN', version: 1, run: findsNothing },
  { ruleId: 'R-ROWS', version: 2, run: findsNothing },
];

describe('revising the versions the user sent back', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let patientRules: Repository<LegacyPatientRule>;
  let ruleVersions: RuleVersionsService;
  let revisions: RuleRevisionsService;

  /** A rule with versions, all inactive until something activates one (1.1.8). */
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

  /**
   * Puts one version in the queue the only way the requirements do: activate
   * it, then decline it (1.2.6). The ticked cross on a row (1.2.8) writes the
   * same three fields through the same call.
   */
  async function queueVersion(
    ruleId: string,
    version: number,
    reason: string | null,
  ): Promise<void> {
    await ruleVersions.activate(ruleId, version);
    await ruleVersions.decline(ruleId, reason);
  }

  async function activeVersionsOf(ruleId: string): Promise<number[]> {
    const active = await versions.find({
      where: { ruleId, status: 'active' },
      order: { version: 'ASC' },
    });

    return active.map((version) => version.version);
  }

  async function versionNumbersOf(ruleId: string): Promise<number[]> {
    const all = await versions.find({ where: { ruleId }, order: { version: 'ASC' } });

    return all.map((version) => version.version);
  }

  /** The queue narrowed to the rules one test seeded, since the file shares a database. */
  async function queueFor(...ruleIds: string[]): Promise<QueuedRevision[]> {
    const entries = await revisions.queue();

    return entries.filter((entry) => ruleIds.includes(entry.ruleId));
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The catalogue ships empty on purpose, so the fakes arrive the way real
      // rules will: through the registry the revision injects.
      .overrideProvider(RuleRegistry)
      .useValue(new RuleRegistry(fakeRules))
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    dataSource = moduleRef.get(DataSource);
    rules = dataSource.getRepository(Rule);
    versions = dataSource.getRepository(RuleVersion);
    patientRules = dataSource.getRepository(LegacyPatientRule);
    ruleVersions = moduleRef.get(RuleVersionsService);
    revisions = moduleRef.get(RuleRevisionsService);
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

  it('queues exactly the versions carrying needsReview, with the rule and the next version', async () => {
    await seedRule('R-QUEUE', [1, 2]);
    await seedRule('R-QUIET', [1]);
    await queueVersion('R-QUEUE', 1, 'It matched rows it should not have.');
    // Active, never declined: the rule is running, so there is nothing to
    // revise and nothing else puts it in the queue (1.5.1).
    await ruleVersions.activate('R-QUIET', 1);
    await ruleVersions.activate('R-QUEUE', 2);

    expect(await queueFor('R-QUEUE', 'R-QUIET')).toEqual([
      {
        ruleId: 'R-QUEUE',
        version: 1,
        reason: 'It matched rows it should not have.',
        ruleName: 'R-QUEUE name',
        description: 'R-QUEUE description',
        ambiguous: false,
        // Two versions exist, so the next one this rule can take is 3 — the
        // number the new code has to be registered under before the row exists.
        nextVersion: 3,
      },
    ]);
  });

  it('writes the next version, activates it, and clears the entry it revised', async () => {
    await seedRule('R-NEXT', [1]);
    await queueVersion('R-NEXT', 1, 'It reformatted numbers that were already right.');

    const report = await revisions.revise({
      ruleId: 'R-NEXT',
      version: 1,
      newVersion: { version: 2 },
    });

    const reviewed = await versions.findOneOrFail({ where: { ruleId: 'R-NEXT', version: 1 } });

    expect(report).toEqual({
      ruleId: 'R-NEXT',
      reviewedVersion: 1,
      newVersion: 2,
      newVersionActivated: true,
      newRuleId: null,
      newRuleActivated: false,
    });
    expect(await activeVersionsOf('R-NEXT')).toEqual([2]);
    expect(reviewed.needsReview).toBe(false);
    expect(await queueFor('R-NEXT')).toEqual([]);
  });

  it('keeps the reviewed version, inactive and with the reason it was declined for', async () => {
    await seedRule('R-KEEP', [1]);
    await queueVersion('R-KEEP', 1, 'It proposed the wrong century on two-digit years.');

    await revisions.revise({ ruleId: 'R-KEEP', version: 1, newVersion: { version: 2 } });

    const reviewed = await versions.findOne({ where: { ruleId: 'R-KEEP', version: 1 } });

    // A rule is never deleted (1.1.8), and the reason is the record of why the
    // revision happened — 1.5.1 clears needsReview and says nothing about it.
    expect(reviewed).not.toBeNull();
    expect(reviewed?.status).toBe('inactive');
    expect(reviewed?.reason).toBe('It proposed the wrong century on two-digit years.');
  });

  it('clears only the entry it revised, leaving the rest of the queue alone', async () => {
    await seedRule('R-PAIR-A', [1]);
    await seedRule('R-PAIR-B', [1]);
    await queueVersion('R-PAIR-A', 1, 'A was too greedy.');
    await queueVersion('R-PAIR-B', 1, 'B was too narrow.');

    await revisions.revise({ ruleId: 'R-PAIR-A', version: 1, newVersion: { version: 2 } });

    const left = await queueFor('R-PAIR-A', 'R-PAIR-B');

    // "Each is revised" is per version: one revision never empties another's
    // flag, so B is still waiting with the feedback that put it there.
    expect(left.map((entry) => entry.ruleId)).toEqual(['R-PAIR-B']);
    expect(left[0].reason).toBe('B was too narrow.');
    expect(left[0].version).toBe(1);
  });

  it('writes a rule alongside the narrowed version and activates both (1.5.2)', async () => {
    await seedRule('R-SPLIT', [1]);
    await queueVersion('R-SPLIT', 1, 'It was two rules in one: the second case needs its own.');

    const report = await revisions.revise({
      ruleId: 'R-SPLIT',
      version: 1,
      newVersion: { version: 2 },
      newRule: {
        ruleId: 'R-SPLIT-NEW',
        ruleName: 'The case the old rule was missing',
        description: 'Proposes the format the narrowed rule no longer touches.',
        ambiguous: true,
      },
    });

    const created = await rules.findOneOrFail({ where: { ruleId: 'R-SPLIT-NEW' } });

    expect(report).toEqual({
      ruleId: 'R-SPLIT',
      reviewedVersion: 1,
      newVersion: 2,
      newVersionActivated: true,
      newRuleId: 'R-SPLIT-NEW',
      newRuleActivated: true,
    });
    expect(await activeVersionsOf('R-SPLIT')).toEqual([2]);
    expect(await activeVersionsOf('R-SPLIT-NEW')).toEqual([1]);
    expect({
      ruleName: created.ruleName,
      description: created.description,
      ambiguous: created.ambiguous,
    }).toEqual({
      ruleName: 'The case the old rule was missing',
      description: 'Proposes the format the narrowed rule no longer touches.',
      ambiguous: true,
    });
    expect(await queueFor('R-SPLIT')).toEqual([]);
  });

  it('can leave the old rule parked while the new one takes over (1.5.2)', async () => {
    await seedRule('R-PARK', [1]);
    await queueVersion('R-PARK', 1, 'This rule was the wrong idea; the replacement is separate.');

    const report = await revisions.revise({
      ruleId: 'R-PARK',
      version: 1,
      newVersion: { version: 2, activate: false },
      newRule: {
        ruleId: 'R-PARK-NEW',
        ruleName: 'The replacement',
        description: 'Does what R-PARK was meant to do.',
        ambiguous: false,
      },
    });

    const parked = await versions.findOneOrFail({ where: { ruleId: 'R-PARK', version: 2 } });

    // Whether the old rule becomes active again is the workflow's decision
    // (1.5.2), so the version is written and simply not activated.
    expect(report.newVersionActivated).toBe(false);
    expect(report.newRuleActivated).toBe(true);
    expect(parked.status).toBe('inactive');
    expect(await activeVersionsOf('R-PARK')).toEqual([]);
    expect(await activeVersionsOf('R-PARK-NEW')).toEqual([1]);
    expect(await queueFor('R-PARK')).toEqual([]);
  });

  it('leaves the revised rule with exactly one active version (1.1.8)', async () => {
    await seedRule('R-ONEACTIVE', [1, 2]);
    await queueVersion('R-ONEACTIVE', 1, 'Version 1 was wrong about Rotterdam.');
    // Somebody put version 2 back in service while version 1 was still in the
    // queue, so this revision activates over a rule that already has an active
    // version rather than over a parked one.
    await ruleVersions.activate('R-ONEACTIVE', 2);

    await revisions.revise({
      ruleId: 'R-ONEACTIVE',
      version: 1,
      newVersion: { version: 3 },
    });

    const superseded = await versions.findOneOrFail({
      where: { ruleId: 'R-ONEACTIVE', version: 2 },
    });

    expect(await activeVersionsOf('R-ONEACTIVE')).toEqual([3]);
    expect(superseded.status).toBe('inactive');
  });

  it('refuses a version the registry has no code for, and writes nothing', async () => {
    await seedRule('R-NOCODE', [1, 2]);
    await queueVersion('R-NOCODE', 1, 'It was too greedy.');
    await ruleVersions.activate('R-NOCODE', 2);

    await expect(
      revisions.revise({ ruleId: 'R-NOCODE', version: 1, newVersion: { version: 3 } }),
    ).rejects.toBeInstanceOf(UnregisteredRuleError);

    const reviewed = await versions.findOneOrFail({ where: { ruleId: 'R-NOCODE', version: 1 } });

    // (ruleId, version) addresses code (1.1.1), and this is the only path that
    // makes a version active: an active version with no code behind it aborts
    // the next run (1.1.14) with nothing to point at.
    expect(await versionNumbersOf('R-NOCODE')).toEqual([1, 2]);
    expect(await activeVersionsOf('R-NOCODE')).toEqual([2]);
    expect(reviewed.needsReview).toBe(true);
  });

  it('refuses a version number that is not above every existing version', async () => {
    await seedRule('R-RENUMBER', [1, 2]);
    await queueVersion('R-RENUMBER', 1, 'It matched nothing at all.');
    await ruleVersions.activate('R-RENUMBER', 2);

    // Both keys have code, so what is refused here is the number and nothing
    // else: versions are appended, never reused and never renumbered (1.1.1).
    await expect(
      revisions.revise({ ruleId: 'R-RENUMBER', version: 1, newVersion: { version: 2 } }),
    ).rejects.toBeInstanceOf(InvalidRevisionError);
    await expect(
      revisions.revise({ ruleId: 'R-RENUMBER', version: 1, newVersion: { version: 1 } }),
    ).rejects.toBeInstanceOf(InvalidRevisionError);

    const reviewed = await versions.findOneOrFail({ where: { ruleId: 'R-RENUMBER', version: 1 } });

    expect(await versionNumbersOf('R-RENUMBER')).toEqual([1, 2]);
    expect(await activeVersionsOf('R-RENUMBER')).toEqual([2]);
    expect(reviewed.needsReview).toBe(true);
    expect(reviewed.reason).toBe('It matched nothing at all.');
  });

  it('refuses a version that is not in the queue, and writes nothing', async () => {
    await seedRule('R-NOTQUEUED', [1]);
    await ruleVersions.activate('R-NOTQUEUED', 1);

    await expect(
      revisions.revise({ ruleId: 'R-NOTQUEUED', version: 1, newVersion: { version: 2 } }),
    ).rejects.toBeInstanceOf(NotQueuedForRevisionError);

    // Only feedback drives a revision (1.5.1). A version nobody declined is a
    // rule that is running, and revising it would retire code nobody asked to
    // retire.
    expect(await versionNumbersOf('R-NOTQUEUED')).toEqual([1]);
    expect(await activeVersionsOf('R-NOTQUEUED')).toEqual([1]);
  });

  it('refuses a version that does not exist at all, and writes nothing', async () => {
    await expect(
      revisions.revise({ ruleId: 'R-ABSENT', version: 1, newVersion: { version: 2 } }),
    ).rejects.toBeInstanceOf(UnknownRuleVersionError);

    expect(await rules.findOne({ where: { ruleId: 'R-ABSENT' } })).toBeNull();
    expect(await versionNumbersOf('R-ABSENT')).toEqual([]);
  });

  it('refuses a revision that would write nothing', async () => {
    await seedRule('R-EMPTY', [1]);
    await queueVersion('R-EMPTY', 1, 'It was wrong, but I have not said how yet.');

    await expect(revisions.revise({ ruleId: 'R-EMPTY', version: 1 })).rejects.toBeInstanceOf(
      InvalidRevisionError,
    );

    const reviewed = await versions.findOneOrFail({ where: { ruleId: 'R-EMPTY', version: 1 } });

    // 1.5.1's outcome is a new version. Clearing the flag without one would
    // drop the feedback and leave the rule parked with no replacement.
    expect(reviewed.needsReview).toBe(true);
  });

  it('rolls the whole revision back when the rule alongside cannot be written', async () => {
    await seedRule('R-ROLLBACK', [1, 2]);
    await seedRule('R-TAKEN', [1]);
    await queueVersion('R-ROLLBACK', 1, 'It needs to split, but the id I chose is taken.');
    await ruleVersions.activate('R-ROLLBACK', 2);

    await expect(
      revisions.revise({
        ruleId: 'R-ROLLBACK',
        version: 1,
        // Valid on its own, and written before the new rule is: only one
        // transaction around the whole revision takes it back again.
        newVersion: { version: 3 },
        newRule: {
          ruleId: 'R-TAKEN',
          ruleName: 'A name that must not land',
          description: 'A description that must not land',
          ambiguous: true,
        },
      }),
    ).rejects.toBeInstanceOf(InvalidRevisionError);

    const reviewed = await versions.findOneOrFail({ where: { ruleId: 'R-ROLLBACK', version: 1 } });
    const taken = await rules.findOneOrFail({ where: { ruleId: 'R-TAKEN' } });

    expect(await versionNumbersOf('R-ROLLBACK')).toEqual([1, 2]);
    expect(await activeVersionsOf('R-ROLLBACK')).toEqual([2]);
    expect(reviewed.needsReview).toBe(true);
    expect(taken.ruleName).toBe('R-TAKEN name');
  });

  it('touches no rule row of any source table', async () => {
    await seedRule('R-ROWS', [1]);
    await queueVersion('R-ROWS', 1, 'P-BUG is the row that exposed it.');
    await patientRules.insert([
      {
        legacyId: 'P-BUG',
        ruleId: 'R-ROWS',
        version: 1,
        column: 'phone',
        previousValue: '0612345678',
        nextValue: '+31612345678',
        status: 'pending',
        reason: null,
      },
      {
        legacyId: 'P-CROSSED',
        ruleId: 'R-ROWS',
        version: 1,
        column: 'phone',
        previousValue: '0698765432',
        nextValue: '+31698765432',
        status: 'declined',
        reason: 'This one is right as it is.',
      },
    ]);

    await revisions.revise({ ruleId: 'R-ROWS', version: 1, newVersion: { version: 2 } });

    const after = await patientRules.find({
      where: { ruleId: 'R-ROWS' },
      order: { legacyId: 'ASC' },
    });

    // The row that exposed the bug stays pending (1.2.8) so the revised version
    // proposes on exactly it, and the crossed-out row stays declined forever
    // (1.2.9). Both are decided by the next run, not by this write.
    expect(after.map((row) => ({ legacyId: row.legacyId, status: row.status }))).toEqual([
      { legacyId: 'P-BUG', status: 'pending' },
      { legacyId: 'P-CROSSED', status: 'declined' },
    ]);
    expect(after[1].reason).toBe('This one is right as it is.');
  });
});
