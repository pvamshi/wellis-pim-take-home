import { Injectable } from '@nestjs/common';
import { DataSource, type EntityTarget, type ObjectLiteral, type Repository } from 'typeorm';
import { LegacyConsent } from '../legacy/legacy-consent.entity';
import { LegacyIntake } from '../legacy/legacy-intake.entity';
import { LegacyPatient } from '../legacy/legacy-patient.entity';
import type { LegacySourceTable } from '../legacy/legacy-source-table';
import { Duplicate, type DuplicateSourceTable, type DuplicateStatus } from '../duplicates/duplicate.entity';
import { Rule } from './rule.entity';

/**
 * One physical legacy row's own column values, keyed by the database column
 * name (`row-detail.service.ts`'s own `LegacyRowValues`, restated here rather
 * than imported: this file's read is its own, not a join with that one).
 */
export type DuplicateRowValues = Record<string, string | null>;

/** One side of a link, as a human reads it and as its row actually holds it. */
export interface DuplicateDetailRow {
  readonly legacyId: string;
  readonly values: DuplicateRowValues;
}

/** A link expanded (1.7.4): both physical rows, side by side, every column. */
export interface DuplicateDetail {
  readonly id: string;
  readonly table: DuplicateSourceTable;
  readonly status: DuplicateStatus;
  readonly ruleId: string;
  readonly ruleName: string;
  /** Integer, matching `rule_version.version` — the version that found this link. */
  readonly version: number;
  /** X — the row that duplicates. */
  readonly duplicate: DuplicateDetailRow;
  /** Y — the one that survives. */
  readonly canonical: DuplicateDetailRow;
}

/** The legacy data table one source's rows live in, and the column that names them. */
interface DuplicateDetailSource {
  readonly data: EntityTarget<ObjectLiteral>;
  readonly legacyIdProperty: string;
}

/**
 * The three legacy sources, keyed by `Duplicate.sourceTable` — restated here
 * rather than shared with `row-detail.service.ts`'s own map, the same
 * per-file restatement that file's own comment already commits to.
 */
const duplicateDetailSources: Record<LegacySourceTable, DuplicateDetailSource> = {
  patient: { data: LegacyPatient, legacyIdProperty: 'legacyPatientId' },
  intake: { data: LegacyIntake, legacyIdProperty: 'legacyIntakeId' },
  consent: { data: LegacyConsent, legacyIdProperty: 'legacyPatientId' },
};

/** One physical row, by the generated id `duplicate.entity.ts`'s two row-id columns carry. */
async function findRow(
  repository: Repository<ObjectLiteral>,
  rowId: string,
): Promise<ObjectLiteral | null> {
  return await repository.createQueryBuilder('row').where('row.id = :rowId', { rowId }).getOne();
}

/**
 * One physical row's own values, reflected off its entity's `metadata.columns`
 * — the technique `row-detail.service.ts`'s private `rowValues` already uses,
 * restated locally rather than imported since that function is not exported.
 * Skips the surrogate `id`, the column naming the row, and `raw_data`, for the
 * same reasons that function gives.
 */
function rowValues(
  repository: Repository<ObjectLiteral>,
  source: DuplicateDetailSource,
  entity: ObjectLiteral,
): DuplicateRowValues {
  const values: DuplicateRowValues = {};

  for (const column of repository.metadata.columns) {
    if (column.propertyName === 'id' || column.propertyName === source.legacyIdProperty) {
      continue;
    }

    if (column.databaseName === 'raw_data') {
      continue;
    }

    values[column.databaseName] = (entity as Record<string, string | null>)[column.propertyName];
  }

  return values;
}

/**
 * One duplicate link expanded (1.7.4): both sides' column values, for
 * `ValueDiff` to draw side by side.
 *
 * It lives here, beside `DuplicateListService`, for the reason every other
 * read in this module already is: 1.1.3 puts the layer that owns the legacy
 * tables here. 1.7.1 already gives every link both physical row ids, so
 * unlike `RowDetailService` (which reads by legacy id and may find several
 * physical rows sharing it), this reads exactly one row per side, by primary
 * key.
 */
@Injectable()
export class DuplicateDetailService {
  constructor(private readonly dataSource: DataSource) {}

  /** A link expanded (1.7.4). Null when no link has this id. */
  async detail(id: string): Promise<DuplicateDetail | null> {
    const link = await this.dataSource.getRepository(Duplicate).findOne({ where: { id } });

    if (link === null) {
      return null;
    }

    const source = duplicateDetailSources[link.sourceTable];
    const repository = this.dataSource.getRepository(source.data);

    const [duplicateEntity, canonicalEntity, rule] = await Promise.all([
      findRow(repository, link.duplicateRowId),
      findRow(repository, link.canonicalRowId),
      this.dataSource.getRepository(Rule).findOne({ where: { ruleId: link.ruleId } }),
    ]);

    // Legacy rows are never deleted post-import, and every link's rule id
    // names a rule this run's rule row already recorded — either missing is a
    // data-integrity fault, not a normal outcome, the same line
    // `RowDetailService.groupFindings` draws for its own equivalent case.
    if (duplicateEntity === null || canonicalEntity === null || rule === null) {
      throw new Error(`duplicate link ${id} points at a row or rule that no longer exists`);
    }

    return {
      id: link.id,
      table: link.sourceTable,
      status: link.status,
      ruleId: link.ruleId,
      ruleName: rule.ruleName,
      version: link.version,
      duplicate: {
        legacyId: link.duplicateLegacyId,
        values: rowValues(repository, source, duplicateEntity),
      },
      canonical: {
        legacyId: link.canonicalLegacyId,
        values: rowValues(repository, source, canonicalEntity),
      },
    };
  }
}
