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

/** What one press of Decline did to a rule (1.2.6). */
export interface RuleDeclineReport {
  readonly ruleId: string;
  /**
   * The version that went inactive. Null only when the press found no active
   * version to act on, because then no version was chosen and nothing written.
   */
  readonly version: number | null;
  /** The reason stored on that version, or null when none was given (1.2.6). */
  readonly reason: string | null;
}

/**
 * The reason as it is stored: trimmed, and null when there is nothing in it.
 *
 * 1.2.6's second scenario is "no reason recorded", and a row holding `" "`
 * records one — the revision workflow (1.5.1) would read a stray space as
 * feedback Vamshi typed. Absent, null and blank are therefore one state.
 */
function storedReason(reason: string | null | undefined): string | null {
  if (typeof reason !== 'string') {
    return null;
  }

  const trimmed = reason.trim();

  return trimmed.length === 0 ? null : trimmed;
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

  /**
   * Declines the rule: its active version goes inactive, `needsReview` becomes
   * true, and the reason is stored on that version when one was given (1.2.6).
   *
   * Nothing is deleted. 1.1.8 makes a rule's life a matter of which version is
   * active, so the version row stays exactly where it was — the rule simply
   * stops appearing on the screen, which filters to active versions (1.2.1),
   * and the modification log keeps pointing at the code that proposed each
   * change already applied (1.3).
   *
   * No rule row is touched either. 1.2.6 speaks only of the version, so the
   * declined version's pending findings sit there until the revision workflow
   * activates a new version (1.5.1); deciding a row is the cross's job (1.2.7),
   * not this one's.
   *
   * `needsReview` is set here and cleared only by that workflow — the same line
   * `activate` above draws, in the other direction.
   *
   * `reason` is written on every press, to the given value or to null, so the
   * stored reason always describes the decline that just happened rather than
   * an earlier one. It matters only for a version that was declined, revived by
   * the revision workflow and declined again.
   *
   * One transaction, so the lookup and the write cannot straddle another press.
   * A rule with no active version — already declined, or a rule id nobody has
   * written — reports `version: null` and writes nothing rather than failing:
   * the same answer `RuleApprovalsService.approveRule` gives for that state,
   * and the operator is one of us pressing from a screen that may be a moment
   * stale (1.2.12).
   */
  async decline(ruleId: string, reason?: string | null): Promise<RuleDeclineReport> {
    const stored = storedReason(reason);

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const repository = manager.getRepository(RuleVersion);
      const active = await repository.findOne({ where: { ruleId, status: 'active' } });

      if (active === null) {
        return { ruleId, version: null, reason: null };
      }

      await repository.update(
        { ruleId, version: active.version },
        { status: 'inactive', needsReview: true, reason: stored },
      );

      return { ruleId, version: active.version, reason: stored };
    });
  }
}
