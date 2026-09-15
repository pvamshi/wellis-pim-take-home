import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, type EntityTarget, type ObjectLiteral, type Repository } from 'typeorm';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LegacyConsent } from '../legacy/legacy-consent.entity';
import { LegacyIntake } from '../legacy/legacy-intake.entity';
import { LegacyPatient } from '../legacy/legacy-patient.entity';
import {
  LegacyConsentRule,
  LegacyIntakeRule,
  LegacyPatientRule,
  type LegacyRuleRow,
} from '../legacy/legacy-rule.entity';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { Rule } from './rule.entity';

/**
 * The reserved rule id a hand edit's finding is written under (1.6.7).
 *
 * Not a P/I/C/D-style code: those prefixes name numbered catalogue families
 * this rule is not part of, and this rule has no code at all — a hand edit is
 * never invoked by the runner, so there is nothing for `catalogue-sync` to
 * find and nothing in `rule-catalogue.ts` naming it. A distinct, non-numeric
 * id can never collide with a future `p66`/`i39`/etc.
 */
export const HAND_EDIT_RULE_ID = 'HAND-EDIT';

/** The name and description the console shows for the reserved rule row. */
const HAND_EDIT_RULE_NAME = 'Hand edit';
const HAND_EDIT_RULE_DESCRIPTION =
  'A value corrected by hand on the rows screen, with no rule behind it (1.6.7).';

/**
 * Thrown when the named column is not one 1.6.7 lets a hand edit write.
 *
 * Three columns fail this even though the entity has them: the surrogate
 * `id` (ours, not theirs), the column holding the legacy id itself (letting it
 * be hand-edited would orphan every finding already keyed to the old id), and
 * `raw_data` (never written after import). These are exactly the three
 * `RowDetailService.rowValues` already excludes from what a row's fields are —
 * a hand edit gets no wider a notion of "the entity's columns" than the screen
 * already reads.
 */
export class UnknownColumnError extends Error {
  constructor(
    readonly table: LegacySourceTable,
    readonly column: string,
  ) {
    super(`legacy ${table} has no column "${column}"`);
    this.name = 'UnknownColumnError';
  }
}

/** What one hand edit did (1.6.7): the address, and both sides of the change. */
export interface RowEditReport {
  /** `patient`, `intake` or `consent` (1.1.14). */
  readonly table: LegacySourceTable;
  readonly legacyId: string;
  /** The database column written, e.g. `full_name`. */
  readonly column: string;
  /** What the column held before this edit. Null when it held nothing. */
  readonly previousValue: string | null;
  /** What was written. Null clears the column (1.2.13's "a blank box is an answer"). */
  readonly nextValue: string | null;
  /** Always `HAND_EDIT_RULE_ID` — legible as a hand edit because of the rule id it carries. */
  readonly ruleId: string;
  /** The finding's own version, unique per `(legacyId, ruleId, column)`. */
  readonly version: number;
  /** Why it was changed by hand, as the human wrote it — kept as the finding's reason. */
  readonly note: string;
}

/** The legacy data table and rule table of one source, and how each is addressed. */
interface RowEditSource {
  readonly data: EntityTarget<ObjectLiteral>;
  /** The property of the data entity holding the legacy id this row is named by. */
  readonly legacyIdProperty: string;
  readonly rules: EntityTarget<LegacyRuleRow>;
}

/**
 * The three legacy sources, keyed by the short name the URL's `:table` segment
 * names — the same `Record<LegacySourceTable, …>` shape `RowDetailService`
 * keeps for the same reason: a hand edit, like a row-detail read, is scoped to
 * the one table its legacy id came from (1.0.3), never all three at once.
 */
const rowEditSources: Record<LegacySourceTable, RowEditSource> = {
  patient: { data: LegacyPatient, legacyIdProperty: 'legacyPatientId', rules: LegacyPatientRule },
  intake: { data: LegacyIntake, legacyIdProperty: 'legacyIntakeId', rules: LegacyIntakeRule },
  consent: {
    data: LegacyConsent,
    // A consent line carries no id of its own, so the patient's legacy id is
    // this table's legacy identity — the same column every other read of
    // `legacy_consent` already keys on.
    legacyIdProperty: 'legacyPatientId',
    rules: LegacyConsentRule,
  },
};

/**
 * The data entity's column a hand edit's `column` names, or the refusal of one
 * of the three columns 1.6.7 does not let a hand edit touch.
 *
 * Matched on `databaseName`, the same technique `resolveColumn`
 * (`rule-approvals.service.ts`) uses for a rule's own proposals: a hand-typed
 * column name never reaches the SQL, and a name that resolves to nothing (or
 * resolves to `id`, the legacy-id column, or `raw_data`) is refused before any
 * transaction opens — nothing is opened just to be rolled back for a mistake
 * pure metadata already answers.
 */
function resolveEditableColumn(
  dataRepository: Repository<ObjectLiteral>,
  source: RowEditSource,
  table: LegacySourceTable,
  column: string,
): ColumnMetadata {
  const resolved = dataRepository.metadata.columns.find(
    (candidate) => candidate.databaseName === column,
  );

  if (
    resolved === undefined ||
    resolved.propertyName === 'id' ||
    resolved.propertyName === source.legacyIdProperty ||
    resolved.databaseName === 'raw_data'
  ) {
    throw new UnknownColumnError(table, column);
  }

  return resolved;
}

/**
 * Makes sure the reserved `rule` row behind every hand edit exists, inserting
 * it the first time one is ever made.
 *
 * Find-then-insert inside the caller's transaction, mirroring
 * `RowRejectionsService.reject`'s idiom for the same shape of "make sure this
 * row exists" write. Never an update on a later edit: the row's name and
 * description are fixed once written, unlike `row_rejection`'s reason, which
 * a second press is meant to replace.
 *
 * `catalogue-sync` never deletes or deactivates a rule it has no code for
 * (given fact), which is exactly what makes this insert permanent and safe —
 * nothing outside this file will ever touch this row again.
 */
async function ensureHandEditRule(manager: EntityManager): Promise<void> {
  const repository = manager.getRepository(Rule);
  const existing = await repository.findOne({ where: { ruleId: HAND_EDIT_RULE_ID } });

  if (existing === null) {
    await repository.insert({
      ruleId: HAND_EDIT_RULE_ID,
      ruleName: HAND_EDIT_RULE_NAME,
      description: HAND_EDIT_RULE_DESCRIPTION,
      ambiguous: false,
    });
  }
}

/**
 * The next version for a hand edit's finding at `(legacyId, HAND_EDIT_RULE_ID,
 * column)`.
 *
 * A finding's primary key is `(legacyId, ruleId, version, column)`, and
 * everything but `version` is fixed for a second edit of the same field, so a
 * repeated version would collide with the first edit instead of recording
 * beside it (1.3: the modification log keeps every change, not just the
 * latest). Read inside the same transaction as the insert it feeds, so nothing
 * else can claim the same version in between.
 */
async function nextHandEditVersion(
  manager: EntityManager,
  source: RowEditSource,
  legacyId: string,
  column: string,
): Promise<number> {
  const row = await manager
    .getRepository(source.rules)
    .createQueryBuilder('finding')
    .select('MAX(finding.version)', 'max')
    .where('finding.legacyId = :legacyId', { legacyId })
    .andWhere('finding.ruleId = :ruleId', { ruleId: HAND_EDIT_RULE_ID })
    .andWhere('finding.column = :column', { column })
    .getRawOne<{ max: number | string | null }>();

  const max = row?.max;

  return (max === null || max === undefined ? 0 : Number(max)) + 1;
}

/**
 * The write path behind a hand edit (1.6.7): one column of one legacy row,
 * written and recorded as an approved finding under the reserved rule id, in
 * one transaction.
 *
 * Lives in `rules/`, exported from `RulesModule`, for the reason
 * `RowDetailService`/`RowListService` already are (1.1.3): it writes both a
 * legacy data table and a rule table, the same two tables
 * `RuleApprovalsService`/`RuleFindingsService` already own.
 *
 * Two things worth being explicit about:
 *
 * - **Multiple physical rows sharing a legacy id (1.0.3) all receive the
 *   edited value.** A legacy id addresses a row without identifying one
 *   everywhere else in this codebase — `RuleApprovalsService.applyPrepared`'s
 *   own blanket `UPDATE … WHERE legacyId = ?` is the same reading — so an edit
 *   gets no private exception to that. `previousValue` is read off the first
 *   of them, ordered by surrogate `id` ascending, the same ordering
 *   `RowDetailService.detail` already uses.
 * - **The finding is written already `approved`.** 1.6.7 requires it: a hand
 *   edit is approved in the same transaction that writes it, because there is
 *   no proposal here for a human to accept later — the edit itself is the
 *   decision.
 */
@Injectable()
export class RowEditService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Writes `value` to `column` on every physical legacy row sharing `legacyId`
   * (1.0.3), and records the change as an approved finding under
   * `HAND_EDIT_RULE_ID`, with `note` as that finding's reason — the column a
   * decline's reason already lives in, so every note a human leaves on a
   * finding is in one place.
   *
   * Null when the legacy data table holds no row with this legacy id — the
   * same 404 shape `RowDetailService.detail` already gives for this exact
   * `(table, legacyId)` address. Throws `UnknownColumnError` for a column the
   * entity does not have, or one of the three it has but 1.6.7 does not let a
   * hand edit touch — before any transaction opens.
   */
  async edit(
    table: LegacySourceTable,
    legacyId: string,
    column: string,
    value: string | null,
    note: string,
  ): Promise<RowEditReport | null> {
    const source = rowEditSources[table];
    const dataRepository = this.dataSource.getRepository(source.data);
    const resolvedColumn = resolveEditableColumn(dataRepository, source, table, column);

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const entities = await manager
        .getRepository(source.data)
        .createQueryBuilder('row')
        .where(`row.${source.legacyIdProperty} = :legacyId`, { legacyId })
        .orderBy('row.id', 'ASC')
        .getMany();

      if (entities.length === 0) {
        return null;
      }

      const previousValue = (entities[0] as Record<string, string | null>)[
        resolvedColumn.propertyName
      ];

      await manager.update(
        source.data,
        { [source.legacyIdProperty]: legacyId },
        { [resolvedColumn.propertyName]: value } as QueryDeepPartialEntity<ObjectLiteral>,
      );

      await ensureHandEditRule(manager);

      const version = await nextHandEditVersion(
        manager,
        source,
        legacyId,
        resolvedColumn.databaseName,
      );

      await manager.getRepository(source.rules).insert({
        legacyId,
        ruleId: HAND_EDIT_RULE_ID,
        version,
        column: resolvedColumn.databaseName,
        previousValue,
        nextValue: value,
        status: 'approved',
        reason: note,
      });

      return {
        table,
        legacyId,
        column: resolvedColumn.databaseName,
        previousValue,
        nextValue: value,
        ruleId: HAND_EDIT_RULE_ID,
        version,
        note,
      };
    });
  }
}
