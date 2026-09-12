import { Injectable } from '@nestjs/common';
import { DataSource, Not, type EntityManager } from 'typeorm';
import { RuleVersion } from './rule-version.entity';

/** Thrown when `activate` is handed a `(ruleId, version)` that does not exist. */
export class UnknownRuleVersionError extends Error {
  constructor(
    readonly ruleId: string,
    readonly version: number,
  ) {
    super(`rule ${ruleId} has no version ${version}`);
    this.name = 'UnknownRuleVersionError';
  }
}

/**
 * The write path onto `rule_version`.
 *
 * "Exactly one version of a rule is active at any time" (1.1.8) is enforced
 * here and again by the partial unique index on the entity. The index is not
 * redundant: it closes the gap this service leaves open for any later caller
 * that writes through a repository of its own.
 */
@Injectable()
export class RuleVersionsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Makes `version` the active version of `ruleId`, and every other version of
   * that rule inactive.
   *
   * One transaction, because a rule with no active version and a rule with two
   * are both states nothing downstream can read (1.2.1, 1.2.10). Deactivating
   * comes first so the unique index is not violated part-way through. Neither
   * `needsReview` nor `reason` is touched — clearing the review queue belongs
   * to the revision workflow (1.5.1), and doing it here would empty that queue
   * behind the workflow's back.
   *
   * Idempotent on the version that is already active. An unknown
   * `(ruleId, version)` throws rather than quietly doing nothing, so a mistyped
   * key cannot leave a rule with no active code.
   */
  async activate(ruleId: string, version: number): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(RuleVersion);
      const target = await repository.findOne({ where: { ruleId, version } });

      if (target === null) {
        throw new UnknownRuleVersionError(ruleId, version);
      }

      await repository.update({ ruleId, version: Not(version) }, { status: 'inactive' });
      await repository.update({ ruleId, version }, { status: 'active' });
    });
  }
}
