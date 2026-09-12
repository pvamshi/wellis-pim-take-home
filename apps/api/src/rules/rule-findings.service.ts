import { Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager, type EntityTarget } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../legacy/legacy-rule.entity';
import type { RuleUpdate } from './rule-contract';
import type { RuleRunResult } from './rule-runner.service';

/**
 * SQLite's ceiling on bound parameters per statement. Re-stated here rather
 * than shared with `import/legacy-import.service.ts`, which measured it against
 * the same `libsql` build: 32766 parameters prepare and run, 32768 fails with
 * "too many SQL variables". Two writers that both bulk-insert is not enough
 * reason to reach into another module for a number.
 *
 * A rule row is eight columns, so one statement carries 4095 findings and a
 * rule that found more is written in as many statements as that takes — never
 * row by row.
 */
const MAX_BOUND_PARAMETERS = 32766;

/**
 * The short name a finding carries (1.1.14) to the table that holds findings
 * against that source.
 *
 * `legacy-source-table.ts` says in so many words that this mapping belongs to
 * whatever persists a finding, and this is that place. A `Map` keyed on plain
 * strings rather than a `Record<LegacySourceTable, …>` because the union is a
 * compile-time guarantee and a rule's response is JSON that crossed a boundary:
 * the lookup has to be able to miss.
 */
const ruleEntities = new Map<string, EntityTarget<LegacyRuleRow>>([
  ['patient', LegacyPatientRule],
  ['intake', LegacyIntakeRule],
  ['consent', LegacyConsentRule],
]);

/**
 * Thrown when an update names a source table that does not exist.
 *
 * Loud, in the style of `UnregisteredRuleError`, and thrown before anything is
 * written: a finding quietly dropped because nobody could work out where to put
 * it is precisely the failure this layer exists to prevent (1.1.3).
 */
export class UnknownSourceTableError extends Error {
  constructor(
    readonly ruleId: string,
    readonly version: number,
    readonly table: string,
  ) {
    super(
      `rule ${ruleId} version ${version} returned an update against unknown source table "${table}"`,
    );
    this.name = 'UnknownSourceTableError';
  }
}

/**
 * What persisting one rule version's response did.
 *
 * The four counters reconcile by construction — `found = declined + repeated +
 * written` — which follows the importer's precedent that a run is validated by
 * comparing counts rather than by tracing rows.
 */
export interface RuleFindingsReportEntry {
  readonly ruleId: string;
  /** Integer, matching `rule_version.version`. */
  readonly version: number;
  /** Updates the rule returned. */
  readonly found: number;
  /** Dropped because the row is declined for this rule and column (1.2.9). */
  readonly declined: number;
  /** Dropped because that exact address is already recorded. */
  readonly repeated: number;
  /** Written as new pending rows. */
  readonly written: number;
}

/** One entry per run entry, in the order the runner produced them. */
export type RuleFindingsReport = RuleFindingsReportEntry[];

/** Everything one source table needs while a persist is in flight. */
interface SourceState {
  readonly entity: EntityTarget<LegacyRuleRow>;
  /** The rule ids this run has findings for against this source. */
  readonly ruleIds: Set<string>;
  /** `(legacyId, ruleId, column)` of every declined row — no version (1.2.9). */
  readonly declined: Set<string>;
  /** `(legacyId, ruleId, version, column)` of every address already spoken for. */
  readonly taken: Set<string>;
  /** The rows to insert, in the order the rules returned them. */
  readonly staged: QueryDeepPartialEntity<LegacyRuleRow>[];
}

/** One update paired with the source it was resolved to. */
interface ResolvedUpdate {
  readonly state: SourceState;
  readonly update: RuleUpdate;
}

/** One run entry, with every update already placed against a source table. */
interface ResolvedEntry {
  readonly ruleId: string;
  readonly version: number;
  readonly updates: ResolvedUpdate[];
}

/**
 * The full address of a finding: the primary key of a rule row.
 *
 * `JSON.stringify` rather than a joined string, because legacy ids, rule ids and
 * column names are all arbitrary text and a separator character appearing inside
 * one of them would make two different addresses collide.
 */
function addressKey(legacyId: string, ruleId: string, version: number, column: string): string {
  return JSON.stringify([legacyId, ruleId, version, column]);
}

/**
 * The address a decline is looked up by. The version is deliberately absent:
 * 1.2.9 checks `(legacyId, ruleId, column)`, so a decline recorded under
 * version 1 still blocks version 2's finding.
 */
function declineKey(legacyId: string, ruleId: string, column: string): string {
  return JSON.stringify([legacyId, ruleId, column]);
}

/**
 * Places every update against the table its own `table` field names (1.1.7),
 * and collects, per source, the rule ids this run touches.
 *
 * Every update in the whole run is resolved here, before a single row is read
 * or written. One update naming a table that does not exist fails the call, so
 * the alternative — half a findings set written and one finding lost — never
 * happens.
 */
function collect(result: RuleRunResult): {
  entries: ResolvedEntry[];
  sources: SourceState[];
} {
  const sources = new Map<string, SourceState>();

  const entries = result.map((entry) => ({
    ruleId: entry.ruleId,
    version: entry.version,
    updates: entry.response.updates.map((update) => {
      const entity = ruleEntities.get(update.table);

      if (entity === undefined) {
        throw new UnknownSourceTableError(entry.ruleId, entry.version, update.table);
      }

      let state = sources.get(update.table);

      if (state === undefined) {
        state = {
          entity,
          ruleIds: new Set<string>(),
          declined: new Set<string>(),
          taken: new Set<string>(),
          staged: [],
        };
        sources.set(update.table, state);
      }

      state.ruleIds.add(entry.ruleId);

      return { state, update };
    }),
  }));

  return { entries, sources: [...sources.values()] };
}

/**
 * One query per involved source table: every row already recorded for any of
 * the rule ids this run found something for.
 *
 * One query, not one per finding. A rule that found 340 rows asks about them in
 * the same statement it asks about the first, which is what makes 1.1.14's
 * batch a batch on the write side too.
 */
async function loadRecorded(manager: EntityManager, sources: SourceState[]): Promise<void> {
  for (const state of sources) {
    const recorded = await manager.getRepository(state.entity).find({
      select: { legacyId: true, ruleId: true, version: true, column: true, status: true },
      where: { ruleId: In([...state.ruleIds]) },
    });

    for (const row of recorded) {
      state.taken.add(addressKey(row.legacyId, row.ruleId, row.version, row.column));

      if (row.status === 'declined') {
        state.declined.add(declineKey(row.legacyId, row.ruleId, row.column));
      }
    }
  }
}

/**
 * Sorts every update into declined, already recorded, or new, and stages the
 * new ones.
 *
 * The three outcomes are tested in that order and they are the whole of the
 * policy in this layer:
 *
 * - **Declined** wins over everything. A row declined for this rule and column
 *   is declined forever (1.2.9), whatever version proposes the change next.
 * - **Already recorded** is left exactly as it stands. Persistence only ever
 *   adds an address that was not there, so an approved row keeps its values and
 *   its status — rewriting one would contradict "acceptance is final" (1.2.11)
 *   and would make the modification log (1.3) describe something that never
 *   happened.
 * - **New** is written pending, with no reason. Status is set explicitly rather
 *   than left to the column default: this layer is the one place that decides a
 *   fresh finding is undecided, and a decision hidden in a schema default is a
 *   decision nobody can see.
 *
 * A staged address is added to `taken` immediately, so two updates at the same
 * address inside one response collapse to the first. That is not a defensive
 * guess: two legacy rows may share one legacy id (1.0.3) and a rule reading
 * whole tables will legitimately return both, while a rule row addresses a
 * legacy id and not a physical row.
 */
function classify(entries: ResolvedEntry[]): RuleFindingsReport {
  return entries.map((entry) => {
    let declined = 0;
    let repeated = 0;
    let written = 0;

    for (const { state, update } of entry.updates) {
      if (state.declined.has(declineKey(update.legacyId, entry.ruleId, update.column))) {
        declined += 1;
        continue;
      }

      const address = addressKey(update.legacyId, entry.ruleId, entry.version, update.column);

      if (state.taken.has(address)) {
        repeated += 1;
        continue;
      }

      state.taken.add(address);
      state.staged.push({
        legacyId: update.legacyId,
        ruleId: entry.ruleId,
        version: entry.version,
        column: update.column,
        previousValue: update.prev,
        nextValue: update.next,
        status: 'pending',
        reason: null,
      });
      written += 1;
    }

    return {
      ruleId: entry.ruleId,
      version: entry.version,
      found: entry.updates.length,
      declined,
      repeated,
      written,
    };
  });
}

/**
 * The staged rows, bulk inserted per source, split only where SQLite's
 * parameter ceiling forces it. The chunk size comes from the entity's own
 * column count, so it is right for the table rather than a number to maintain.
 *
 * `orIgnore` is a belt behind the classification above, not a substitute for
 * it: the counts this call reports come from the classification, so relying on
 * the database to swallow a collision would make them lie.
 *
 * `updateEntity(false)` is not an optimisation. TypeORM's default is to read
 * back every column carrying a database default — `status` here — by selecting
 * the rows it just inserted, keyed on their four-part primary key. At a few
 * thousand rows that `WHERE` is a boolean tree SQLite refuses to parse
 * ("Expression tree is too large"), and there is nothing to read back anyway:
 * this function inserts plain values, sets `status` itself, and returns nothing
 * to a caller.
 */
async function writeStaged(manager: EntityManager, sources: SourceState[]): Promise<void> {
  for (const state of sources) {
    if (state.staged.length === 0) {
      continue;
    }

    const repository = manager.getRepository(state.entity);
    const chunkSize = Math.max(
      1,
      Math.floor(MAX_BOUND_PARAMETERS / repository.metadata.columns.length),
    );

    for (let start = 0; start < state.staged.length; start += chunkSize) {
      await repository
        .createQueryBuilder()
        .insert()
        .values(state.staged.slice(start, start + chunkSize))
        .orIgnore()
        .updateEntity(false)
        .execute();
    }
  }
}

/**
 * The shared API of 1.1.3: it takes the JSON a run produced and writes the rule
 * rows.
 *
 * The runner collects and writes nothing; the rules read and write nothing. All
 * of the writing is here, and so is the only policy either of them would
 * otherwise have to carry — the declined-row skip of 1.2.9 lives in this file
 * and in no rule.
 *
 * Three properties worth stating:
 *
 * - **Nothing is ever rewritten.** A persist only inserts addresses that were
 *   not in the table before. That is what keeps 1.2.11 and the modification log
 *   (1.3) honest, and it is why pressing Apply rules twice is harmless.
 * - **One transaction for the whole call.** A half-written findings set is a
 *   set the rules screen would read as complete. This is not 1.2.5's apply
 *   transaction, which belongs with applying accepted changes — the other half
 *   of 1.1.3's sentence, and not built here.
 * - **It interprets nothing.** An ambiguous rule's null `next` values (1.1.12)
 *   are stored as they arrived; whether a finding is right is decided in the UI
 *   (1.1.10), never on the way into the table.
 */
@Injectable()
export class RuleFindingsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Writes a run's findings as pending rule rows, and reports what it did. */
  async persist(result: RuleRunResult): Promise<RuleFindingsReport> {
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const { entries, sources } = collect(result);

      await loadRecorded(manager, sources);

      const report = classify(entries);

      await writeStaged(manager, sources);

      return report;
    });
  }
}
