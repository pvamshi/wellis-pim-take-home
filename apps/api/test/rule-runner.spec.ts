import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LegacyPatient } from '../src/legacy/legacy-patient.entity';
import type { RegisteredRule, RuleFunction, RuleUpdate } from '../src/rules/rule-contract';
import { RuleRegistry, UnregisteredRuleError } from '../src/rules/rule-registry';
import { RuleRunnerService, type RuleRunResult } from '../src/rules/rule-runner.service';
import { RuleVersion } from '../src/rules/rule-version.entity';
import { RuleVersionsService } from '../src/rules/rule-versions.service';
import { Rule } from '../src/rules/rule.entity';
import { createTemporaryDatabase, type TemporaryDatabase } from './temp-database';

/**
 * The runner, against a real database and fake rules.
 *
 * Fakes, because this body of work is the infrastructure rules run on and not
 * the rules. Every fake reads real rows and returns findings derived from them,
 * so an assertion about a run is an assertion about data the runner actually
 * reached — not about a stub having been called.
 *
 * The whole run is driven from `rule` and `rule_version` rows: the registry is
 * overridden with the fakes below, which is the same wiring the endpoint in
 * T3.4 will use, and the catalogue stays empty.
 */

/** A row of a legacy table as the driver returns it, columns and all. */
type StoredRow = Record<string, string | null>;

/** The columns a seeded patient sets; the rest default to null. */
interface PatientSeed {
  legacyPatientId: string;
  fullName?: string | null;
  email?: string | null;
  dob?: string | null;
  phone?: string | null;
  city?: string | null;
  rawData: string;
}

/**
 * Every call any fake rule received, in order, as `ruleId@version`.
 *
 * 1.1.14 says a rule is called once and not once per row, so "how many times"
 * is part of the behaviour under test rather than a stand-in for it. Every
 * assertion on this log sits beside an assertion on what came back.
 */
const callLog: string[] = [];

/** Wraps a rule body so the run records which key was called, and when. */
function loggingRule(ruleId: string, version: number, body: RuleFunction): RegisteredRule {
  return {
    ruleId,
    version,
    run: (context) => {
      callLog.push(`${ruleId}@${version}`);

      return body(context);
    },
  };
}

/** Proposes the international form of every Dutch number written the old way. */
const proposePhone: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: false,
    updates: patients
      .filter((patient) => patient.phone?.startsWith('06') === true)
      .map((patient) => ({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'phone',
        prev: patient.phone,
        next: `+31${patient.phone?.slice(1) ?? ''}`,
      })),
  };
};

/** The same idea on another column, so two rules' findings cannot be confused. */
const proposeEmailDomain: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: false,
    updates: patients
      .filter((patient) => patient.email?.endsWith('@old.example') === true)
      .map((patient) => ({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'email',
        prev: patient.email,
        next: patient.email?.replace('@old.example', '@new.example') ?? null,
      })),
  };
};

/** A rule that finds a problem it cannot fix (1.1.12): every `next` is null. */
const flagAmbiguousDob: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: true,
    updates: patients
      .filter((patient) => patient.dob?.includes('/') === true)
      .map((patient) => ({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'dob',
        prev: patient.dob,
        next: null,
      })),
  };
};

/** Reads the whole table and matches none of it. */
const matchNothing: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: false,
    updates: patients
      .filter((patient) => patient.city === 'Atlantis')
      .map((patient) => ({
        table: 'patient' as const,
        legacyId: patient.legacyPatientId,
        column: 'city',
        prev: patient.city,
        next: 'Atlantis-2',
      })),
  };
};

/** One update per row in the table, whatever the table holds. */
const proposeEveryRow: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient);

  return {
    ambiguity: false,
    updates: patients.map((patient) => ({
      table: 'patient' as const,
      legacyId: patient.legacyPatientId,
      column: 'full_name',
      prev: patient.fullName,
      next: `${patient.fullName ?? ''} (checked)`,
    })),
  };
};

/** The bulk case: every Zwolle patient's phone, in one response. */
const proposeZwollePhone: RuleFunction = async (context) => {
  const patients = await context.find(LegacyPatient, { where: { city: 'Zwolle' } });

  return {
    ambiguity: false,
    updates: patients.map((patient) => ({
      table: 'patient' as const,
      legacyId: patient.legacyPatientId,
      column: 'phone',
      prev: patient.phone,
      next: `+31${patient.phone?.slice(1) ?? ''}`,
    })),
  };
};

/** The exact error a failing rule throws, so the test can insist on identity. */
const ruleFailure = new Error('the rule could not make sense of what it read');

const alwaysThrows: RuleFunction = async () => {
  throw ruleFailure;
};

/**
 * Every fake the suite registers. Each test activates its own rule ids, so one
 * test's active version can never be picked up by another's run.
 *
 * `R-NO-CODE` is deliberately absent: it is the active version whose code a
 * deploy lost.
 */
const fakeRules: RegisteredRule[] = [
  loggingRule('R-AO-A', 1, proposeEmailDomain),
  loggingRule('R-AO-A', 2, proposePhone),
  loggingRule('R-AO-B', 1, flagAmbiguousDob),
  loggingRule('R-EVERY-1', 1, proposePhone),
  loggingRule('R-EVERY-2', 3, proposeEmailDomain),
  loggingRule('R-EVERY-3', 1, flagAmbiguousDob),
  loggingRule('R-BULK', 1, proposeZwollePhone),
  loggingRule('R-AMBIG', 2, flagAmbiguousDob),
  loggingRule('R-NEW', 1, proposePhone),
  loggingRule('R-QUIET', 1, matchNothing),
  loggingRule('R-LOUD', 1, proposePhone),
  loggingRule('R-CURRENT', 1, proposePhone),
  loggingRule('R-WHOLE', 1, proposeEveryRow),
  loggingRule('R-WRITES-PHONE', 1, proposePhone),
  loggingRule('R-WRITES-DOB', 1, flagAmbiguousDob),
  loggingRule('R-IDLE', 1, proposePhone),
  loggingRule('R-ZZ-REGISTERED', 1, proposePhone),
  loggingRule('R-BOOM', 1, alwaysThrows),
  loggingRule('R-ZZ-AFTER-BOOM', 1, proposePhone),
];

/**
 * The patients every test starts from.
 *
 * A function rather than a constant, because `save` writes the generated id
 * back into the object it was handed, and a shared object carrying a stale id
 * would be updated instead of inserted on the next test.
 *
 * The three fakes that read it match three different sets: phone P-1 and P-3,
 * email P-2 and P-4, dob P-1 and P-3.
 */
function fixedPatients(): PatientSeed[] {
  return [
    {
      legacyPatientId: 'P-1',
      fullName: 'Ana de Vries',
      email: 'ana@new.example',
      dob: '03/07/1984',
      phone: '0612345678',
      city: 'Utrecht',
      rawData: '{"id":"P-1"}',
    },
    {
      legacyPatientId: 'P-2',
      fullName: 'Bram Jansen',
      email: 'bram@old.example',
      dob: '1984-07-03',
      phone: '+31612345679',
      city: 'Amsterdam',
      rawData: '{"id":"P-2"}',
    },
    {
      legacyPatientId: 'P-3',
      fullName: 'Cas Bakker',
      email: 'cas@new.example',
      dob: '11/12/1990',
      phone: '0698765432',
      city: 'Rotterdam',
      rawData: '{"id":"P-3"}',
    },
    {
      legacyPatientId: 'P-4',
      fullName: 'Dee Smit',
      email: 'dee@old.example',
      dob: '1990-12-11',
      phone: null,
      city: 'Den Haag',
      rawData: '{"id":"P-4"}',
    },
  ];
}

/** Sorted, so no assertion depends on the order rows come back in. */
function byLegacyId(updates: RuleUpdate[]): RuleUpdate[] {
  return [...updates].sort((left, right) => left.legacyId.localeCompare(right.legacyId));
}

/** The keys a run reports, in the order the runner produced them. */
function keysOf(result: RuleRunResult): string[] {
  return result.map((entry) => `${entry.ruleId}@${entry.version}`);
}

describe('running every active rule version', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let database: TemporaryDatabase;
  let previousDatabaseUrl: string | undefined;
  let patients: Repository<LegacyPatient>;
  let rules: Repository<Rule>;
  let versions: Repository<RuleVersion>;
  let ruleVersions: RuleVersionsService;
  let runner: RuleRunnerService;

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

  /** Chunked, so a few hundred seed rows stay inside SQLite's parameter limit. */
  async function insertPatients(rows: PatientSeed[]): Promise<void> {
    for (let index = 0; index < rows.length; index += 50) {
      await patients.insert(rows.slice(index, index + 50));
    }
  }

  beforeAll(async () => {
    database = createTemporaryDatabase();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = database.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The catalogue ships empty on purpose, so the fakes arrive the way real
      // rules will: through the registry the runner injects.
      .overrideProvider(RuleRegistry)
      .useValue(new RuleRegistry(fakeRules))
      .compile();

    app = moduleRef.createNestApplication();
    // Booting is what creates the tables: `synchronize: true` and no migration
    // step to stand in for it (tech-stack 4.4).
    await app.init();
    dataSource = moduleRef.get(DataSource);
    patients = dataSource.getRepository(LegacyPatient);
    rules = dataSource.getRepository(Rule);
    versions = dataSource.getRepository(RuleVersion);
    ruleVersions = moduleRef.get(RuleVersionsService);
    runner = moduleRef.get(RuleRunnerService);
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
    callLog.length = 0;
    await dataSource.query(`DELETE FROM rule_version`);
    await dataSource.query(`DELETE FROM rule`);
    await dataSource.query(`DELETE FROM legacy_patient`);
    await insertPatients(fixedPatients());
  });

  it('runs the active version of a rule and skips every inactive one', async () => {
    await seedRule('R-AO-A', [1, 2]);
    await seedRule('R-AO-B', [1]);
    await ruleVersions.activate('R-AO-A', 2);

    const result = await runner.run();

    // Driven by `rule_version.status` and nothing else (1.2.10). A-v2's code is
    // the phone rule and A-v1's is the email rule, so the findings say which
    // code ran, not just which key was tagged.
    expect(keysOf(result)).toEqual(['R-AO-A@2']);
    expect(byLegacyId(result[0]?.response.updates ?? [])).toEqual([
      {
        table: 'patient',
        legacyId: 'P-1',
        column: 'phone',
        prev: '0612345678',
        next: '+31612345678',
      },
      {
        table: 'patient',
        legacyId: 'P-3',
        column: 'phone',
        prev: '0698765432',
        next: '+31698765432',
      },
    ]);
    expect(callLog).toEqual(['R-AO-A@2']);
  });

  it('calls every active version exactly once, tagged with the key that ran', async () => {
    await seedRule('R-EVERY-1', [1]);
    await seedRule('R-EVERY-2', [1, 2, 3]);
    await seedRule('R-EVERY-3', [1]);
    // Activated out of order, so the run's order is the runner's doing.
    await ruleVersions.activate('R-EVERY-3', 1);
    await ruleVersions.activate('R-EVERY-1', 1);
    await ruleVersions.activate('R-EVERY-2', 3);

    const result = await runner.run();

    // Every active version, blindly (1.1.14), in ascending (ruleId, version)
    // order, each carrying the version that produced it (1.3).
    expect(keysOf(result)).toEqual(['R-EVERY-1@1', 'R-EVERY-2@3', 'R-EVERY-3@1']);
    expect(callLog).toEqual(['R-EVERY-1@1', 'R-EVERY-2@3', 'R-EVERY-3@1']);

    // And each entry holds what its own code found, not another rule's.
    expect(byLegacyId(result[0]?.response.updates ?? []).map((update) => update.legacyId)).toEqual([
      'P-1',
      'P-3',
    ]);
    expect(result[0]?.response.ambiguity).toBe(false);
    expect(byLegacyId(result[1]?.response.updates ?? [])).toEqual([
      {
        table: 'patient',
        legacyId: 'P-2',
        column: 'email',
        prev: 'bram@old.example',
        next: 'bram@new.example',
      },
      {
        table: 'patient',
        legacyId: 'P-4',
        column: 'email',
        prev: 'dee@old.example',
        next: 'dee@new.example',
      },
    ]);
    expect(result[2]?.response.ambiguity).toBe(true);
    expect(byLegacyId(result[2]?.response.updates ?? []).map((update) => update.column)).toEqual([
      'dob',
      'dob',
    ]);
  });

  it('calls a rule once for 340 rows, not once per row', async () => {
    const bulk = Array.from({ length: 340 }, (_, index) => ({
      legacyPatientId: `P-Z${String(index).padStart(3, '0')}`,
      fullName: `Zwolle ${index}`,
      email: 'z@new.example',
      dob: '1979-01-01',
      phone: `06${String(10_000_000 + index)}`,
      city: 'Zwolle',
      rawData: `{"id":"P-Z${String(index).padStart(3, '0')}"}`,
    }));

    await insertPatients(bulk);
    await seedRule('R-BULK', [1]);
    await ruleVersions.activate('R-BULK', 1);

    const result = await runner.run();

    // 1.1.14's scenario: one call, 340 changes in a single response, each
    // carrying table, row, column, previous and next.
    expect(callLog).toEqual(['R-BULK@1']);
    expect(result).toHaveLength(1);
    expect(result[0]?.response.updates).toHaveLength(340);
    expect(byLegacyId(result[0]?.response.updates ?? [])).toEqual(
      bulk.map((patient) => ({
        table: 'patient',
        legacyId: patient.legacyPatientId,
        column: 'phone',
        prev: patient.phone,
        next: `+31${patient.phone.slice(1)}`,
      })),
    );
  });

  it('hands back the response exactly as the rule returned it', async () => {
    await seedRule('R-AMBIG', [2]);
    await ruleVersions.activate('R-AMBIG', 2);

    const result = await runner.run();
    const response = result[0]?.response;

    // Collected, not interpreted: the rule-wide flag is still true (1.1.12),
    // every next is still null, and nothing was normalised, filled in, dropped
    // or added on the way out.
    expect(Object.keys(response ?? {}).sort()).toEqual(['ambiguity', 'updates']);
    expect(response?.ambiguity).toBe(true);
    expect(byLegacyId(response?.updates ?? [])).toEqual([
      { table: 'patient', legacyId: 'P-1', column: 'dob', prev: '03/07/1984', next: null },
      { table: 'patient', legacyId: 'P-3', column: 'dob', prev: '11/12/1990', next: null },
    ]);
  });

  it('produces findings for a newly activated version with no prior approval', async () => {
    await seedRule('R-NEW', [1]);
    await ruleVersions.activate('R-NEW', 1);

    const result = await runner.run();

    // 1.1.11: nothing gates rule creation. The version was written and
    // activated a moment ago, nothing approved it, and it produces findings on
    // the very next run.
    expect(keysOf(result)).toEqual(['R-NEW@1']);
    expect(byLegacyId(result[0]?.response.updates ?? []).map((update) => update.legacyId)).toEqual([
      'P-1',
      'P-3',
    ]);

    const [approvals] = await dataSource.query<{ rows: number }[]>(
      `SELECT COUNT(*) AS rows FROM legacy_patient_rule`,
    );

    expect(approvals?.rows).toBe(0);
  });

  it('keeps a rule that matched nothing in the result, with an empty batch', async () => {
    await seedRule('R-QUIET', [1]);
    await seedRule('R-LOUD', [1]);
    await ruleVersions.activate('R-QUIET', 1);
    await ruleVersions.activate('R-LOUD', 1);

    const result = await runner.run();

    // A rule that matches nothing is invisible in the UI (1.1.11), but that is
    // a filter the rules screen applies to pending rows (1.2.1). The runner
    // reports what it ran, so an empty response is an entry like any other.
    expect(keysOf(result)).toEqual(['R-LOUD@1', 'R-QUIET@1']);
    expect(result[1]?.response).toEqual({ ambiguity: false, updates: [] });
    expect(result[0]?.response.updates).toHaveLength(2);
    expect(callLog).toEqual(['R-LOUD@1', 'R-QUIET@1']);
  });

  it('reads the data as it stands now, not a snapshot of an earlier run', async () => {
    await seedRule('R-CURRENT', [1]);
    await ruleVersions.activate('R-CURRENT', 1);

    const first = await runner.run();

    expect(byLegacyId(first[0]?.response.updates ?? []).map((update) => update.legacyId)).toEqual([
      'P-1',
      'P-3',
    ]);

    // What an approved fix and a fresh import look like from the rule's side.
    await patients.update({ legacyPatientId: 'P-1' }, { phone: '+31612345678' });
    await insertPatients([
      {
        legacyPatientId: 'P-9',
        fullName: 'Eef Mulder',
        email: 'eef@new.example',
        dob: '1975-05-05',
        phone: '0655555555',
        city: 'Breda',
        rawData: '{"id":"P-9"}',
      },
    ]);

    const second = await runner.run();

    // 1.2.10: rules read the modified data. The row that was fixed stops
    // matching and the row that arrived after the first run is found.
    expect(byLegacyId(second[0]?.response.updates ?? [])).toEqual([
      {
        table: 'patient',
        legacyId: 'P-3',
        column: 'phone',
        prev: '0698765432',
        next: '+31698765432',
      },
      {
        table: 'patient',
        legacyId: 'P-9',
        column: 'phone',
        prev: '0655555555',
        next: '+31655555555',
      },
    ]);
  });

  it('runs against the entire dataset, with no page or limit of its own', async () => {
    const extra = Array.from({ length: 96 }, (_, index) => ({
      legacyPatientId: `P-G${String(index).padStart(3, '0')}`,
      fullName: `Groningen ${index}`,
      email: 'g@new.example',
      dob: '1981-02-02',
      phone: '+31600000000',
      city: 'Groningen',
      rawData: `{"id":"P-G${String(index).padStart(3, '0')}"}`,
    }));

    await insertPatients(extra);
    await seedRule('R-WHOLE', [1]);
    await ruleVersions.activate('R-WHOLE', 1);

    const result = await runner.run();
    const seenIds = (result[0]?.response.updates ?? []).map((update) => update.legacyId).sort();
    const seededIds = [...fixedPatients(), ...extra]
      .map((patient) => patient.legacyPatientId)
      .sort();

    // 1.2.10: every active rule version runs against the entire dataset. The
    // rule returns one update per row it saw, so a page or a limit anywhere
    // between the table and the rule would show up as missing rows here.
    expect(seenIds).toHaveLength(100);
    expect(seenIds).toEqual(seededIds);
    expect(result[0]?.response.updates).toContainEqual({
      table: 'patient',
      legacyId: 'P-2',
      column: 'full_name',
      prev: 'Bram Jansen',
      next: 'Bram Jansen (checked)',
    });
  });

  it('writes nothing at all while collecting findings', async () => {
    await seedRule('R-WRITES-PHONE', [1]);
    await seedRule('R-WRITES-DOB', [1]);
    await ruleVersions.activate('R-WRITES-PHONE', 1);
    await ruleVersions.activate('R-WRITES-DOB', 1);

    const before = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    const result = await runner.run();

    const after = await dataSource.query<StoredRow[]>(
      `SELECT * FROM legacy_patient ORDER BY legacy_id`,
    );

    // The comparison has something to compare: findings were produced against
    // the very columns the rules propose changing.
    expect(before).toHaveLength(4);
    expect(result.flatMap((entry) => entry.response.updates)).toHaveLength(4);

    // 1.1.2: nothing written to any data table. Column by column, so a
    // rewritten value anywhere in any row shows up.
    expect(after).toEqual(before);

    // And nothing written to any rule table either — turning a response into
    // rule rows is the persistence layer's job (1.1.3), not the runner's.
    for (const table of ['legacy_patient_rule', 'legacy_intake_rule', 'legacy_consent_rule']) {
      const [counted] = await dataSource.query<{ rows: number }[]>(
        `SELECT COUNT(*) AS rows FROM ${table}`,
      );

      expect(counted?.rows).toBe(0);
    }

    // Including `rule_version`: running a rule is not a decision about it
    // (1.2.6, 1.5.1).
    const ran = await versions.find({ order: { ruleId: 'ASC' } });

    expect(ran.map((version) => [version.ruleId, version.status, version.needsReview])).toEqual([
      ['R-WRITES-DOB', 'active', false],
      ['R-WRITES-PHONE', 'active', false],
    ]);
  });

  it('calls nothing when no version is active, however many rules exist', async () => {
    await seedRule('R-IDLE', [1]);

    const result = await runner.run();

    // The rows drive the run, not the catalogue: code is registered for
    // R-IDLE v1, and it stays uncalled because no row says it is active.
    expect(result).toEqual([]);
    expect(callLog).toEqual([]);
  });

  it('fails the whole run when an active version has no registered code', async () => {
    await seedRule('R-NO-CODE', [1]);
    await seedRule('R-ZZ-REGISTERED', [1]);
    await ruleVersions.activate('R-NO-CODE', 1);
    await ruleVersions.activate('R-ZZ-REGISTERED', 1);

    const failure: unknown = await runner.run().catch((error: unknown) => error);

    // A deploy that lost a rule's code is visible rather than quietly producing
    // a findings set that looks complete (1.1.1). The run stops there: the
    // registered rule that sorts after it never ran, and no partial result came
    // back.
    expect(failure).toBeInstanceOf(UnregisteredRuleError);
    expect(failure).toMatchObject({ ruleId: 'R-NO-CODE', version: 1 });
    expect(callLog).toEqual([]);
  });

  it('lets a failing rule abort the run instead of swallowing it', async () => {
    await seedRule('R-BOOM', [1]);
    await seedRule('R-ZZ-AFTER-BOOM', [1]);
    await ruleVersions.activate('R-BOOM', 1);
    await ruleVersions.activate('R-ZZ-AFTER-BOOM', 1);

    const failure: unknown = await runner.run().catch((error: unknown) => error);

    // The error reaches the caller unchanged, and the rules after it do not
    // run — a run either produces a complete result or fails.
    expect(failure).toBe(ruleFailure);
    expect(callLog).toEqual(['R-BOOM@1']);
  });
});
