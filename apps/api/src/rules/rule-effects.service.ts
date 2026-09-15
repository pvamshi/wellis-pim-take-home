import { Injectable } from '@nestjs/common';
import { DataSource, type EntityTarget } from 'typeorm';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../legacy/legacy-rule.entity';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { Patient } from '../patient/patient.entity';
import { createRuleContext } from './rule-context';
import type { RuleUpdate } from './rule-contract';
import { RuleRegistry } from './rule-registry';
import { RowListService } from './row-list.service';

const RULE_TABLES: ReadonlyArray<{
  readonly table: LegacySourceTable;
  readonly entity: EntityTarget<LegacyRuleRow>;
}> = [
  { table: 'patient', entity: LegacyPatientRule },
  { table: 'intake', entity: LegacyIntakeRule },
  { table: 'consent', entity: LegacyConsentRule },
];

/** Examples kept per group; counts are always complete. */
const EXAMPLE_LIMIT = 10;

/** Page size when reading which rows are Import clean — the rows list's own cap. */
const ROW_PAGE = 500;

/** One address a version finds, with what the column holds and what each version proposes there. */
export interface RuleEffectExample {
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  readonly column: string;
  /** What the column holds now. */
  readonly current: string | null;
  /** The old version's proposal; absent when it finds nothing here. */
  readonly before?: string | null;
  /** The new version's proposal; absent when it finds nothing here. */
  readonly after?: string | null;
}

export interface RuleEffectGroup {
  readonly count: number;
  readonly examples: RuleEffectExample[];
}

/**
 * What changing a rule from one version to another would do to the current
 * data (1.5.3): both versions run, nothing is written.
 */
export interface RuleEffects {
  readonly ruleId: string;
  /** The version compared against; null when `to` is the rule's first version. */
  readonly from: number | null;
  readonly to: number;
  readonly foundBefore: number;
  readonly foundAfter: number;
  /** Found by the new version and not the old. */
  readonly newlyFound: RuleEffectGroup;
  /** Found by the old version and not the new. */
  readonly noLongerFound: RuleEffectGroup;
  /** Found by both, proposing different values. */
  readonly proposalChanged: RuleEffectGroup;
  readonly unchanged: number;
  /** New pending findings Apply rules would record for the new version. */
  readonly wouldRecord: RuleEffectGroup;
  /** New-version findings already recorded, which Apply rules leaves as they are. */
  readonly alreadyRecorded: number;
  /** New-version findings a human declined before, at any version (1.2.9), which are never raised again. */
  readonly declinedEarlier: RuleEffectGroup;
  /** New-version findings on imported patients, which record nothing (2.6). */
  readonly onImportedPatients: number;
  /** Pending findings of older versions, which keep their rows pending until someone decides them. */
  readonly oldPendingLeft: RuleEffectGroup;
  /** Rows now Import clean that would become pending once Apply rules records the new findings. */
  readonly rowsBecomingPending: number;
  readonly linksBefore: number;
  readonly linksAfter: number;
}

/** A `from` or `to` that names no registered version, or a `from` not before `to`. */
export class RuleEffectsVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleEffectsVersionError';
  }
}

function addressKey(table: string, legacyId: string, column: string): string {
  return JSON.stringify([table, legacyId, column]);
}

function byAddress(updates: readonly RuleUpdate[]): Map<string, RuleUpdate> {
  const map = new Map<string, RuleUpdate>();

  for (const update of updates) {
    const key = addressKey(update.table, update.legacyId, update.column);
    if (!map.has(key)) map.set(key, update);
  }

  return map;
}

interface MutableGroup {
  count: number;
  examples: RuleEffectExample[];
}

function emptyGroup(): MutableGroup {
  return { count: 0, examples: [] };
}

function add(group: MutableGroup, example: RuleEffectExample): void {
  group.count += 1;
  if (group.examples.length < EXAMPLE_LIMIT) group.examples.push(example);
}

/**
 * Runs two versions of one rule against the current data and reports the
 * difference, before anyone presses Apply rules (1.5.3).
 *
 * Rules never write (1.1.2), so running both is free of side effects; what the
 * new version would actually record is decided the way `RuleFindingsService`
 * decides it — declined addresses, addresses already recorded and imported
 * patients all record nothing.
 */
@Injectable()
export class RuleEffectsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: RuleRegistry,
    private readonly rows: RowListService,
  ) {}

  /** Null when no code is registered for the rule. */
  async effects(ruleId: string, from?: number, to?: number): Promise<RuleEffects | null> {
    const versions = this.registry.versionsOf(ruleId);
    if (versions.length === 0) return null;

    const target = to ?? versions[versions.length - 1];
    if (!versions.includes(target)) {
      throw new RuleEffectsVersionError(`${ruleId} has no version ${target} in code`);
    }

    const earlier = versions.filter((version) => version < target);
    const baseline = from === undefined ? (earlier[earlier.length - 1] ?? null) : from;
    if (baseline !== null && !earlier.includes(baseline)) {
      throw new RuleEffectsVersionError(
        `from must be a version of ${ruleId} in code, before ${target}`,
      );
    }

    const context = createRuleContext(this.dataSource.manager);
    const after = await this.registry.run(ruleId, target, context);
    const before = baseline === null ? null : await this.registry.run(ruleId, baseline, context);

    const afterByAddress = byAddress(after.updates);
    const beforeByAddress =
      before === null ? new Map<string, RuleUpdate>() : byAddress(before.updates);

    const declined = new Set<string>();
    const recordedTarget = new Set<string>();
    const oldPendingLeft = emptyGroup();

    for (const { table, entity } of RULE_TABLES) {
      const recorded = await this.dataSource.getRepository(entity).find({ where: { ruleId } });

      for (const row of recorded) {
        const key = addressKey(table, row.legacyId, row.column);
        if (row.status === 'declined') declined.add(key);
        if (row.version === target) recordedTarget.add(key);
        if (row.status === 'pending' && row.version !== target) {
          add(oldPendingLeft, {
            table,
            legacyId: row.legacyId,
            column: row.column,
            current: row.previousValue,
            before: row.nextValue,
          });
        }
      }
    }

    const imported = await this.importedLegacyIds();
    const clean = await this.cleanRows(new Set([...afterByAddress.values()].map((u) => u.table)));

    const newlyFound = emptyGroup();
    const proposalChanged = emptyGroup();
    const wouldRecord = emptyGroup();
    const declinedEarlier = emptyGroup();
    const becomingPending = new Set<string>();
    let unchanged = 0;
    let alreadyRecorded = 0;
    let onImportedPatients = 0;

    for (const [key, update] of afterByAddress) {
      const previous = beforeByAddress.get(key);
      const example: RuleEffectExample = {
        table: update.table,
        legacyId: update.legacyId,
        column: update.column,
        current: update.prev,
        ...(previous === undefined ? {} : { before: previous.next }),
        after: update.next,
      };

      if (previous === undefined) add(newlyFound, example);
      else if (previous.next !== update.next) add(proposalChanged, example);
      else unchanged += 1;

      if (update.table === 'patient' && imported.has(update.legacyId)) {
        onImportedPatients += 1;
      } else if (declined.has(key)) {
        add(declinedEarlier, example);
      } else if (recordedTarget.has(key)) {
        alreadyRecorded += 1;
      } else {
        add(wouldRecord, example);
        const row = JSON.stringify([update.table, update.legacyId]);
        if (clean.has(row)) becomingPending.add(row);
      }
    }

    const noLongerFound = emptyGroup();

    for (const [key, previous] of beforeByAddress) {
      if (afterByAddress.has(key)) continue;
      add(noLongerFound, {
        table: previous.table,
        legacyId: previous.legacyId,
        column: previous.column,
        current: previous.prev,
        before: previous.next,
      });
    }

    return {
      ruleId,
      from: baseline,
      to: target,
      foundBefore: beforeByAddress.size,
      foundAfter: afterByAddress.size,
      newlyFound,
      noLongerFound,
      proposalChanged,
      unchanged,
      wouldRecord,
      alreadyRecorded,
      declinedEarlier,
      onImportedPatients,
      oldPendingLeft,
      rowsBecomingPending: becomingPending.size,
      linksBefore: before?.duplicates?.length ?? 0,
      linksAfter: after.duplicates?.length ?? 0,
    };
  }

  private async importedLegacyIds(): Promise<Set<string>> {
    const rows = await this.dataSource
      .getRepository(Patient)
      .createQueryBuilder('patient')
      .select('patient.legacyId', 'legacyId')
      .where('patient.legacy_id IS NOT NULL')
      .getRawMany<{ legacyId: string }>();

    return new Set(rows.map((row) => row.legacyId));
  }

  /** `[table, legacyId]` of every Import clean row in the given tables. */
  private async cleanRows(tables: ReadonlySet<LegacySourceTable>): Promise<Set<string>> {
    const clean = new Set<string>();

    for (const table of tables) {
      for (let offset = 0; ; offset += ROW_PAGE) {
        const page = await this.rows.list({ table, state: 'clean', offset, limit: ROW_PAGE });
        for (const row of page.rows) clean.add(JSON.stringify([table, row.legacyId]));
        if (page.rows.length === 0 || offset + page.rows.length >= page.total) break;
      }
    }

    return clean;
  }
}
