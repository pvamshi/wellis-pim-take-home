import { Injectable } from '@nestjs/common';
import { DataSource, In, type FindOptionsWhere } from 'typeorm';
import { Duplicate, type DuplicateSourceTable, type DuplicateStatus } from '../duplicates/duplicate.entity';
import { Rule } from './rule.entity';

/** One link on the duplicates screen (1.7.4): source, X, Y, and the rule that found it. */
export interface DuplicateListEntry {
  readonly id: string;
  readonly table: DuplicateSourceTable;
  readonly duplicateLegacyId: string;
  readonly canonicalLegacyId: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly status: DuplicateStatus;
}

/** What the duplicates screen may narrow the list to (1.7.4), and which slice it wants. */
export interface DuplicateListFilter {
  readonly table?: DuplicateSourceTable;
  readonly status?: DuplicateStatus;
  /** How many links to skip. Defaults to none. */
  readonly offset?: number;
  /** How many to return. Defaults to `DUPLICATES_DEFAULT_LIMIT`, capped at `DUPLICATES_MAX_LIMIT`. */
  readonly limit?: number;
}

/** One slice of the links the filter matches, and how many there are in all. */
export interface DuplicateListResult {
  readonly links: DuplicateListEntry[];
  readonly total: number;
}

/** Links returned when the caller names no limit. */
export const DUPLICATES_DEFAULT_LIMIT = 100;

/** The most links one call will return, however large a limit is asked for (`RowListService`'s own cap). */
export const DUPLICATES_MAX_LIMIT = 500;

/**
 * The duplicates screen's list (1.7.4): every link the filter matches, with
 * the rule that found it.
 *
 * Unlike `RowListService`, `status` and `table` are columns `duplicate`
 * actually stores (`duplicate.entity.ts`), not derived from other tables — so
 * filtering, ordering and paging all happen in the query itself rather than
 * being built in memory first.
 *
 * Sorted `(table, duplicateLegacyId, canonicalLegacyId, id)` for a stable,
 * repeatable order across two loads, the same reason `RowListService` sorts
 * its own list.
 */
@Injectable()
export class DuplicateListService {
  constructor(private readonly dataSource: DataSource) {}

  async list(filter: DuplicateListFilter = {}): Promise<DuplicateListResult> {
    const where: FindOptionsWhere<Duplicate> = {};

    if (filter.table !== undefined) {
      where.sourceTable = filter.table;
    }

    if (filter.status !== undefined) {
      where.status = filter.status;
    }

    const offset = filter.offset ?? 0;
    const limit = Math.min(filter.limit ?? DUPLICATES_DEFAULT_LIMIT, DUPLICATES_MAX_LIMIT);

    const repository = this.dataSource.getRepository(Duplicate);

    const [links, total] = await Promise.all([
      repository.find({
        where,
        order: {
          sourceTable: 'ASC',
          duplicateLegacyId: 'ASC',
          canonicalLegacyId: 'ASC',
          id: 'ASC',
        },
        skip: offset,
        take: limit,
      }),
      repository.count({ where }),
    ]);

    const ruleNames = await this.ruleNames(links.map((link) => link.ruleId));

    return {
      links: links.map((link) => ({
        id: link.id,
        table: link.sourceTable,
        duplicateLegacyId: link.duplicateLegacyId,
        canonicalLegacyId: link.canonicalLegacyId,
        ruleId: link.ruleId,
        ruleName: ruleNames.get(link.ruleId) ?? this.missingRuleName(link),
        status: link.status,
      })),
      total,
    };
  }

  /**
   * Every rule name this page's links need, in one batched lookup — the same
   * `IN` pattern `RowDetailService.groupFindings` uses, because a rule name
   * never varies by link and so is worth reading once per rule rather than
   * once per link.
   */
  private async ruleNames(ruleIds: string[]): Promise<Map<string, string>> {
    if (ruleIds.length === 0) {
      return new Map();
    }

    const rules = await this.dataSource
      .getRepository(Rule)
      .find({ where: { ruleId: In([...new Set(ruleIds)]) } });

    return new Map(rules.map((rule) => [rule.ruleId, rule.ruleName]));
  }

  /** A link whose rule id has no matching `Rule` row is a data-integrity fault. */
  private missingRuleName(link: Duplicate): never {
    throw new Error(`duplicate link ${link.id} names rule "${link.ruleId}", which has no rule row`);
  }
}
