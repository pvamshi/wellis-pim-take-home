import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { Rule } from '../rules/rule.entity';
import { RuleVersion } from '../rules/rule-version.entity';
import { ruleCatalogue } from '../rules/rule-catalogue';
import type { CatalogueRule } from '../rules/rule-contract';

export interface CatalogueSyncReport {
  rulesAdded: string[];
  rulesUpdated: string[];
  versionsAdded: string[];
  versionsActivated: string[];
  untouched: number;
}

/**
 * Makes the `rule` and `rule_version` tables match the code catalogue.
 *
 * The catalogue is the source of truth for what code exists; the database is
 * the source of truth for what is active and what is queued for revision
 * (1.6.1). This reconciles the first into the second and never the other way —
 * which is why it writes `status` and `needs_review` only when it is creating a
 * version row, and leaves both alone on a row that already exists.
 *
 * Idempotent by construction, so it can be run after every rule and re-run
 * safely after an interrupted session.
 */
@Injectable()
export class CatalogueSyncService {
  constructor(private readonly dataSource: DataSource) {}

  async sync(catalogue: readonly CatalogueRule[] = ruleCatalogue): Promise<CatalogueSyncReport> {
    const report: CatalogueSyncReport = {
      rulesAdded: [],
      rulesUpdated: [],
      versionsAdded: [],
      versionsActivated: [],
      untouched: 0,
    };

    await this.dataSource.transaction(async (manager: EntityManager) => {
      for (const entry of catalogue) {
        await this.syncRule(manager, entry, report);
      }

      for (const [ruleId, version] of highestVersions(catalogue)) {
        await this.activateHighest(manager, ruleId, version, report);
      }
    });

    return report;
  }

  private async syncRule(
    manager: EntityManager,
    entry: CatalogueRule,
    report: CatalogueSyncReport,
  ): Promise<void> {
    const rules = manager.getRepository(Rule);
    const existing = await rules.findOne({ where: { ruleId: entry.ruleId } });

    if (!existing) {
      await rules.insert({
        ruleId: entry.ruleId,
        ruleName: entry.ruleName,
        description: entry.description,
        ambiguous: entry.ambiguous,
      });
      report.rulesAdded.push(entry.ruleId);
    } else if (
      existing.ruleName !== entry.ruleName ||
      existing.description !== entry.description ||
      existing.ambiguous !== entry.ambiguous
    ) {
      await rules.update(
        { ruleId: entry.ruleId },
        { ruleName: entry.ruleName, description: entry.description, ambiguous: entry.ambiguous },
      );
      report.rulesUpdated.push(entry.ruleId);
    } else {
      report.untouched += 1;
    }

    const versions = manager.getRepository(RuleVersion);
    const key = { ruleId: entry.ruleId, version: entry.version };
    const version = await versions.findOne({ where: key });

    if (!version) {
      // Inserted inactive. activateHighest below decides what runs, so a rule
      // whose newest version is parked for revision is not silently revived.
      await versions.insert({ ...key, status: 'inactive', needsReview: false, reason: null });
      report.versionsAdded.push(`${entry.ruleId}@${entry.version}`);
    }
  }

  /**
   * Activates the newest version of a rule, unless a human has parked it.
   *
   * A version carrying `needs_review` was declined (1.2.6) or sent back from a
   * row (1.2.8) and is waiting on the revision workflow. Re-activating it here
   * would undo that decision, so this stops at the first sign of one.
   */
  private async activateHighest(
    manager: EntityManager,
    ruleId: string,
    version: number,
    report: CatalogueSyncReport,
  ): Promise<void> {
    const versions = manager.getRepository(RuleVersion);
    const target = await versions.findOne({ where: { ruleId, version } });

    if (!target || target.status === 'active' || target.needsReview) {
      return;
    }

    const queued = await versions.findOne({ where: { ruleId, needsReview: true } });
    if (queued) {
      return;
    }

    await versions.update({ ruleId }, { status: 'inactive' });
    await versions.update({ ruleId, version }, { status: 'active' });
    report.versionsActivated.push(`${ruleId}@${version}`);
  }
}

/** The newest registered version of each rule, which is the one that should run. */
function highestVersions(catalogue: readonly CatalogueRule[]): Map<string, number> {
  const highest = new Map<string, number>();

  for (const entry of catalogue) {
    const current = highest.get(entry.ruleId);
    if (current === undefined || entry.version > current) {
      highest.set(entry.ruleId, entry.version);
    }
  }

  return highest;
}
