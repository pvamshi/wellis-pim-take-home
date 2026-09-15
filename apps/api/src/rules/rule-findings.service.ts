import { Injectable } from '@nestjs/common';
import {
  DataSource,
  In,
  type EntityManager,
  type EntityTarget,
  type ObjectLiteral,
  type Repository,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Duplicate, type DuplicateSourceTable } from '../duplicates/duplicate.entity';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../legacy/legacy-rule.entity';
import { Patient } from '../patient/patient.entity';
import type { RuleUpdate } from './rule-contract';
import type { RuleRunResult } from './rule-runner.service';

/**
 * SQLite's ceiling on bound parameters per statement. Re-stated here rather
 * than shared with `import/legacy-import.service.ts`, which measured it against
 * the same `libsql` build: 32766 parameters prepare and run, 32768 fails with
 * "too many SQL variables". Two writers that both bulk-insert is not enough
 * reason to reach into another module for a number.
 *
 * A rule row is eight columns and a duplicate row nine, so `bulkInsert` below
 * derives the actual chunk size from the target table's own column count
 * rather than this comment doing the arithmetic.
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
 *
 * Its keys are also the whole of what a source table may be, so a duplicate
 * finding's `table` is checked against it too (below) rather than against a
 * map of its own — `Duplicate` has no per-source entity to look up, but it has
 * the same three valid names.
 */
const ruleEntities = new Map<string, EntityTarget<LegacyRuleRow>>([
  ['patient', LegacyPatientRule],
  ['intake', LegacyIntakeRule],
  ['consent', LegacyConsentRule],
]);

/**
 * Thrown when an update or a duplicate finding names a source table that does
 * not exist.
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
 * Thrown when a duplicate finding is missing the row id either side needs
 * (1.7.1). A legacy id names a row without identifying one (1.0.3), so a link
 * carrying only legacy ids identifies nothing — this is the same "quietly
 * dropped" failure `UnknownSourceTableError` exists to prevent, thrown before
 * anything is written so the whole run fails atomically rather than writing a
 * findings set with one link missing (1.7.1).
 */
export class DuplicateLinkMissingRowIdError extends Error {
  constructor(
    readonly ruleId: string,
    readonly version: number,
    readonly table: string,
    readonly duplicateLegacyId: string,
    readonly canonicalLegacyId: string,
  ) {
    super(
      `rule ${ruleId} version ${version} returned a duplicate link between "${duplicateLegacyId}" ` +
        `and "${canonicalLegacyId}" on ${table} without both row ids`,
    );
    this.name = 'DuplicateLinkMissingRowIdError';
  }
}

/**
 * What persisting one rule version's response did.
 *
 * The four update counters reconcile by construction — `found = declined +
 * repeated + written` — which follows the importer's precedent that a run is
 * validated by comparing counts rather than by tracing rows. The three link
 * counters reconcile the same way: `linksFound = linksRecorded + linksSkipped`.
 * There is no link analogue of `declined` — 1.7 defines no per-address decline
 * for a duplicate link, only the rule-agnostic skip 1.7.2 describes.
 */
export interface RuleFindingsReportEntry {
  readonly ruleId: string;
  /** Integer, matching `rule_version.version`. */
  readonly version: number;
  /** Updates the rule returned. */
  readonly found: number;
  /** Dropped because the row is declined for this rule and column (1.2.9), or is a legacy patient already imported (2.6). */
  readonly declined: number;
  /** Dropped because that exact address is already recorded. */
  readonly repeated: number;
  /** Written as new pending rows. */
  readonly written: number;
  /** Duplicate links the rule returned (1.7.2). */
  readonly linksFound: number;
  /** Written as new pending links. */
  readonly linksRecorded: number;
  /** Dropped because that pair of rows is already linked, in any status (1.7.2). */
  readonly linksSkipped: number;
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

/**
 * One duplicate finding, already checked for what `persist` needs before it
 * reads or writes anything: a known source table and both row ids present.
 */
interface ResolvedDuplicate {
  readonly sourceTable: DuplicateSourceTable;
  readonly duplicateLegacyId: string;
  readonly duplicateRowId: string;
  readonly canonicalLegacyId: string;
  readonly canonicalRowId: string;
}

/** One run entry, with every finding already placed and validated. */
interface ResolvedEntry {
  readonly ruleId: string;
  readonly version: number;
  readonly updates: ResolvedUpdate[];
  readonly duplicates: ResolvedDuplicate[];
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
 * The pair a duplicate link is tracked under: the ordered `(sourceTable,
 * duplicateRowId, canonicalRowId)` the unique index on `duplicate` also keys on
 * (`duplicate.entity.ts`). No `ruleId` or `version` — 1.7.2's "any rule, at any
 * version" is what makes a pair already-linked regardless of who recorded it —
 * and no `status`, so a dismissed link is never re-recorded either.
 */
function linkKey(
  sourceTable: DuplicateSourceTable,
  duplicateRowId: string,
  canonicalRowId: string,
): string {
  return JSON.stringify([sourceTable, duplicateRowId, canonicalRowId]);
}

/**
 * Places every update against the table its own `table` field names (1.1.7),
 * checks every duplicate finding against the same three valid tables and
 * requires both its row ids (1.7.1), and collects, per source, the rule ids
 * this run touches for updates and the source tables it touches for links.
 *
 * Every finding in the whole run is resolved here, before a single row is
 * read or written. One update naming a table that does not exist, or one
 * duplicate missing a row id, fails the call, so the alternative — half a
 * findings set written and one finding lost — never happens.
 */
function collect(result: RuleRunResult): {
  entries: ResolvedEntry[];
  sources: SourceState[];
  duplicateSourceTables: DuplicateSourceTable[];
} {
  const sources = new Map<string, SourceState>();
  const duplicateSourceTables = new Set<DuplicateSourceTable>();

  const entries = result.map((entry) => {
    const updates = entry.response.updates.map((update) => {
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
    });

    const duplicates = (entry.response.duplicates ?? []).map((duplicate) => {
      if (!ruleEntities.has(duplicate.table)) {
        throw new UnknownSourceTableError(entry.ruleId, entry.version, duplicate.table);
      }

      if (duplicate.duplicateRowId === undefined || duplicate.canonicalRowId === undefined) {
        throw new DuplicateLinkMissingRowIdError(
          entry.ruleId,
          entry.version,
          duplicate.table,
          duplicate.duplicateLegacyId,
          duplicate.canonicalLegacyId,
        );
      }

      duplicateSourceTables.add(duplicate.table);

      return {
        sourceTable: duplicate.table,
        duplicateLegacyId: duplicate.duplicateLegacyId,
        duplicateRowId: duplicate.duplicateRowId,
        canonicalLegacyId: duplicate.canonicalLegacyId,
        canonicalRowId: duplicate.canonicalRowId,
      };
    });

    return { ruleId: entry.ruleId, version: entry.version, updates, duplicates };
  });

  return {
    entries,
    sources: [...sources.values()],
    duplicateSourceTables: [...duplicateSourceTables],
  };
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
 * Every pair already linked, in any status, for the source tables this run
 * touches — one query per touched source, against the one shared `duplicate`
 * table (1.7.2).
 *
 * Not scoped by `ruleId`: a pair is "already linked" regardless of which rule
 * or version recorded it, which is what makes "the same pair again" and "a
 * dismissed pair, found by a different rule" both skip. Not scoped by
 * `status` either, for the same reason — a dismissed link is a link.
 */
async function loadLinked(
  manager: EntityManager,
  sourceTables: DuplicateSourceTable[],
): Promise<Set<string>> {
  const linked = new Set<string>();

  for (const sourceTable of sourceTables) {
    const recorded = await manager.getRepository(Duplicate).find({
      select: { sourceTable: true, duplicateRowId: true, canonicalRowId: true },
      where: { sourceTable },
    });

    for (const row of recorded) {
      linked.add(linkKey(row.sourceTable, row.duplicateRowId, row.canonicalRowId));
    }
  }

  return linked;
}

/**
 * Every legacy patient id already imported into `patient` (2.6). An imported
 * row is final, so nothing more is recorded against it — a merge proposed into
 * it would never be applied.
 */
async function loadImported(manager: EntityManager): Promise<Set<string>> {
  const rows = await manager
    .getRepository(Patient)
    .createQueryBuilder('patient')
    .select('patient.legacyId', 'legacyId')
    .where('patient.legacy_id IS NOT NULL')
    .getRawMany<{ legacyId: string }>();

  return new Set(rows.map((row) => row.legacyId));
}

/**
 * Sorts every update into declined, already recorded, or new, and every
 * duplicate finding into already linked or new — staging the new ones of each
 * — and returns one report entry per run entry.
 *
 * Updates keep the three outcomes this layer has always had:
 *
 * - **Declined** wins over everything. A row declined for this rule and column
 *   is declined forever (1.2.9), whatever version proposes the change next. A
 *   legacy patient already imported (2.6) counts here too, as does any link
 *   naming one: both are final.
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
 * A duplicate finding has only two outcomes — recorded or skipped — because a
 * link carries no per-address decline (1.7's own scope). Skip covers a pair
 * already linked before this run started or staged earlier in this same run;
 * either way the key is added to `linked` immediately, so two findings for one
 * pair — one rule or two — collapse into the first, exactly like two updates at
 * one address already do.
 */
function classify(
  entries: ResolvedEntry[],
  linked: Set<string>,
  imported: Set<string>,
): { report: RuleFindingsReport; duplicateStaged: QueryDeepPartialEntity<Duplicate>[] } {
  const duplicateStaged: QueryDeepPartialEntity<Duplicate>[] = [];

  const report = entries.map((entry) => {
    let declined = 0;
    let repeated = 0;
    let written = 0;

    for (const { state, update } of entry.updates) {
      if (
        (update.table === 'patient' && imported.has(update.legacyId)) ||
        state.declined.has(declineKey(update.legacyId, entry.ruleId, update.column))
      ) {
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

    let linksRecorded = 0;
    let linksSkipped = 0;

    for (const duplicate of entry.duplicates) {
      const key = linkKey(
        duplicate.sourceTable,
        duplicate.duplicateRowId,
        duplicate.canonicalRowId,
      );

      const namesImported =
        duplicate.sourceTable === 'patient' &&
        (imported.has(duplicate.duplicateLegacyId) || imported.has(duplicate.canonicalLegacyId));

      if (namesImported || linked.has(key)) {
        linksSkipped += 1;
        continue;
      }

      linked.add(key);
      duplicateStaged.push({
        sourceTable: duplicate.sourceTable,
        duplicateLegacyId: duplicate.duplicateLegacyId,
        duplicateRowId: duplicate.duplicateRowId,
        canonicalLegacyId: duplicate.canonicalLegacyId,
        canonicalRowId: duplicate.canonicalRowId,
        ruleId: entry.ruleId,
        version: entry.version,
        status: 'pending',
      });
      linksRecorded += 1;
    }

    return {
      ruleId: entry.ruleId,
      version: entry.version,
      found: entry.updates.length,
      declined,
      repeated,
      written,
      linksFound: entry.duplicates.length,
      linksRecorded,
      linksSkipped,
    };
  });

  return { report, duplicateStaged };
}

/**
 * Bulk inserts staged rows into one repository, chunked only where SQLite's
 * bound-parameter ceiling forces it. Shared by the rule tables and `duplicate`,
 * which is the only reason it is generic rather than living inside
 * `writeStaged` as it used to.
 *
 * `orIgnore` is a belt behind the classification above, not a substitute for
 * it: the counts a caller reports come from the classification, so relying on
 * the database to swallow a collision would make them lie. `duplicate`'s own
 * unique index (`duplicate.entity.ts`) is exactly that belt for links.
 *
 * `updateEntity(false)` is not an optimisation. TypeORM's default is to read
 * back every column carrying a database default by selecting the rows it just
 * inserted, keyed on the entity's primary key — a `WHERE` SQLite refuses to
 * parse at a few thousand rows ("Expression tree is too large"), and there is
 * nothing to read back anyway: every caller here sets every column itself and
 * returns nothing to its own caller.
 */
async function bulkInsert<Entity extends ObjectLiteral>(
  repository: Repository<Entity>,
  staged: QueryDeepPartialEntity<Entity>[],
): Promise<void> {
  if (staged.length === 0) {
    return;
  }

  const chunkSize = Math.max(
    1,
    Math.floor(MAX_BOUND_PARAMETERS / repository.metadata.columns.length),
  );

  for (let start = 0; start < staged.length; start += chunkSize) {
    await repository
      .createQueryBuilder()
      .insert()
      .values(staged.slice(start, start + chunkSize))
      .orIgnore()
      .updateEntity(false)
      .execute();
  }
}

/** The staged rows for every touched source table, written one repository at a time. */
async function writeStaged(manager: EntityManager, sources: SourceState[]): Promise<void> {
  for (const state of sources) {
    await bulkInsert(manager.getRepository(state.entity), state.staged);
  }
}

/**
 * The shared API of 1.1.3: it takes the JSON a run produced and writes the rule
 * rows, and now the duplicate links alongside them (1.7.2).
 *
 * The runner collects and writes nothing; the rules read and write nothing. All
 * of the writing is here, and so is the only policy either of them would
 * otherwise have to carry — the declined-row skip of 1.2.9 and the already-
 * linked skip of 1.7.2 both live in this file and in no rule.
 *
 * Three properties worth stating:
 *
 * - **Nothing is ever rewritten.** A persist only inserts addresses, and
 *   pairs, that were not in their table before. That is what keeps 1.2.11 and
 *   the modification log (1.3) honest, and it is why pressing Apply rules
 *   twice is harmless for findings and links alike.
 * - **One transaction for the whole call.** A half-written findings set is a
 *   set the rules screen would read as complete, and a half-written batch of
 *   links is exactly what 1.7.1 asks not to happen. This is not 1.2.5's apply
 *   transaction, which belongs with applying accepted changes — the other half
 *   of 1.1.3's sentence, and not built here.
 * - **It interprets nothing.** An ambiguous rule's null `next` values (1.1.12)
 *   are stored as they arrived; whether a finding is right is decided in the UI
 *   (1.1.10), never on the way into the table. A duplicate finding is stored
 *   the same way — this layer decides only whether a pair is new, never
 *   whether the rule was right to link it.
 */
@Injectable()
export class RuleFindingsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Writes a run's findings and duplicate links as pending rows, and reports what it did. */
  async persist(result: RuleRunResult): Promise<RuleFindingsReport> {
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const { entries, sources, duplicateSourceTables } = collect(result);

      await loadRecorded(manager, sources);
      const linked = await loadLinked(manager, duplicateSourceTables);
      const imported = await loadImported(manager);

      const { report, duplicateStaged } = classify(entries, linked, imported);

      await writeStaged(manager, sources);
      await bulkInsert(manager.getRepository(Duplicate), duplicateStaged);

      return report;
    });
  }
}
