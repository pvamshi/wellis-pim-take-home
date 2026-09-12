import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, type ObjectLiteral, type Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { readCsv, readJsonl, type SourceRecord } from './legacy-file-reader';
import { legacySources, type LegacySource } from './legacy-sources';

/**
 * SQLite's ceiling on bound parameters per statement, measured on the `libsql`
 * build this project uses: 32766 parameters prepare and run, 32768 fails with
 * "too many SQL variables".
 *
 * It is why "a single bulk insert" (1.0.1) is honoured as one bulk operation in
 * the fewest statements the ceiling allows rather than one statement come what
 * may: patients.csv is 2466 rows across 16 columns, which is 39,456 parameters
 * and physically cannot be one statement. Every file still lands in a handful
 * of statements — five for the whole export — never row by row.
 */
const MAX_BOUND_PARAMETERS = 32766;

/** What one file's import did. `read` is `inserted + skipped`, by construction. */
export interface LegacyFileReport {
  readonly file: string;
  readonly table: string;
  readonly read: number;
  readonly inserted: number;
  readonly skipped: number;
}

/** One row ready to insert, paired with the legacy id it is keyed on. */
interface MappedRow {
  readonly legacyId: string;
  readonly values: QueryDeepPartialEntity<ObjectLiteral>;
}

/**
 * Loads `legacy_export/` into the three legacy tables.
 *
 * The shape is fixed by 1.0.1 and is the same for all three files: read the
 * whole file, collect its ids, ask in ONE query which of them the database
 * already holds, and insert the remainder in bulk. Nothing here looks at a
 * value to decide anything — identity is the legacy id and the id being present
 * is the whole test (1.0.2) — and nothing de-duplicates the batch, so two rows
 * sharing an id both land (1.0.3, 1.0.4).
 */
@Injectable()
export class LegacyImportService {
  constructor(private readonly dataSource: DataSource) {}

  /** Imports every source, in export order, and reports each one. */
  async importAll(exportDirectory: string): Promise<LegacyFileReport[]> {
    const reports: LegacyFileReport[] = [];

    for (const source of legacySources) {
      reports.push(await this.importSource(exportDirectory, source));
    }

    return reports;
  }

  /**
   * One file, one transaction. The existence query and the inserts are the same
   * unit of work: a run that failed halfway would leave a table the reported
   * numbers do not describe, and those numbers reconciling is what makes a run
   * checkable by counting rather than by tracing rows (1.0.1).
   */
  async importSource(exportDirectory: string, source: LegacySource): Promise<LegacyFileReport> {
    const path = join(exportDirectory, source.file);
    const records = source.format === 'csv' ? readCsv(path) : readJsonl(path);
    const rows = records.map((record) => mapRecord(source, record, path));

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(source.entity);
      const existing = await findExistingLegacyIds(repository, source, rows);

      // Membership alone partitions the file. Every occurrence is preserved, so
      // an id repeated inside the file is inserted as many times as it appears.
      const toInsert = rows.filter((row) => !existing.has(row.legacyId));
      const skipped = rows.length - toInsert.length;

      await bulkInsert(repository, toInsert);

      return {
        file: source.file,
        table: source.table,
        read: rows.length,
        inserted: toInsert.length,
        skipped,
      };
    });
  }
}

/**
 * Export record -> entity row, through the descriptor and nothing else.
 *
 * A CSV column the descriptor maps but the file's header does not carry is an
 * error, not a null: the counts this import reports are only worth anything as
 * a validation tool if a column silently going missing is loud. A JSONL line
 * has no header to disagree with, so a key it simply does not carry is null.
 */
function mapRecord(source: LegacySource, { record, raw }: SourceRecord, path: string): MappedRow {
  const values: Record<string, unknown> = { rawData: raw };

  for (const [column, property] of Object.entries(source.columns)) {
    if (source.format === 'csv' && !(column in record)) {
      throw new Error(`${path} has no column "${column}"`);
    }

    values[property] = record[column] === undefined ? null : record[column];
  }

  const legacyId = values[source.legacyIdProperty];

  if (typeof legacyId !== 'string') {
    // Everything downstream — the existence query, the partition, the report —
    // keys on this value. A row without one cannot be placed at all.
    throw new Error(`${path} has a row whose legacy id is missing: ${raw}`);
  }

  return { legacyId, values: values as QueryDeepPartialEntity<ObjectLiteral> };
}

/**
 * The one query 1.0.1 asks for: which of this file's ids does the database
 * already hold? The parameter list is de-duplicated because it is a lookup —
 * asking for the same id twice answers the same question — while the batch it
 * is used to partition keeps every occurrence (1.0.3).
 */
async function findExistingLegacyIds(
  repository: Repository<ObjectLiteral>,
  source: LegacySource,
  rows: readonly MappedRow[],
): Promise<Set<string>> {
  if (rows.length === 0) {
    return new Set();
  }

  const ids = [...new Set(rows.map((row) => row.legacyId))];
  const found = await repository
    .createQueryBuilder('row')
    .select(`row.${source.legacyIdProperty}`, 'legacyId')
    .where(`row.${source.legacyIdProperty} IN (:...ids)`, { ids })
    .getRawMany<{ legacyId: string }>();

  return new Set(found.map((row) => row.legacyId));
}

/**
 * One bulk insert per file, split only where SQLite's parameter ceiling forces
 * it. The chunk size comes from the entity's own column count, so it is right
 * for each table rather than a number per table someone has to maintain.
 */
async function bulkInsert(
  repository: Repository<ObjectLiteral>,
  rows: readonly MappedRow[],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const chunkSize = Math.max(
    1,
    Math.floor(MAX_BOUND_PARAMETERS / repository.metadata.columns.length),
  );

  for (let start = 0; start < rows.length; start += chunkSize) {
    await repository.insert(rows.slice(start, start + chunkSize).map((row) => row.values));
  }
}
