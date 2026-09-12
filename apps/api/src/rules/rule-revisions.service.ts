import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { RuleRegistry } from './rule-registry';
import { RuleVersion } from './rule-version.entity';
import { UnknownRuleVersionError, activateWithin } from './rule-versions.service';
import { Rule } from './rule.entity';

/**
 * Thrown when the version named for revision exists but is not in the queue.
 *
 * Deliberately not `UnknownRuleVersionError`, which is about a key that does
 * not exist: a version nobody declined is a real row that simply has no
 * feedback behind it, and 1.5.1 makes feedback the only thing that drives a
 * revision.
 */
export class NotQueuedForRevisionError extends Error {
  constructor(
    readonly ruleId: string,
    readonly version: number,
  ) {
    super(`rule ${ruleId} version ${version} is not queued for revision`);
    this.name = 'NotQueuedForRevisionError';
  }
}

/** Thrown when a revision request cannot be applied as it stands. */
export class InvalidRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRevisionError';
  }
}

/**
 * One entry of the revision queue: a version carrying `needsReview`, the rule
 * it versions, and the number the next version of that rule must take.
 *
 * The reason and the rule's own description are the evidence 1.5.1 names, so
 * they travel with the entry. The rule's pending rows deliberately do not: a
 * rule that matched 340 rows would push all of them into the context of
 * whatever reads this queue, and the reason is what says what went wrong.
 */
export interface QueuedRevision {
  readonly ruleId: string;
  /** The version that was declined, and so the one being revised. */
  readonly version: number;
  /** Why it was declined, or null when no reason was given (1.2.6). */
  readonly reason: string | null;
  readonly ruleName: string;
  /** What the human reads in place of a value for an ambiguous rule (1.1.12). */
  readonly description: string;
  readonly ambiguous: boolean;
  /**
   * One above the highest version this rule has, which is the number the next
   * version must take. Reported rather than computed at write time because the
   * code has to be registered under `(ruleId, version)` before the row can
   * exist (1.1.1), so whoever writes the code needs the number first.
   */
  readonly nextVersion: number;
}

/** The new version of the reviewed rule, when the revision writes one. */
export interface NewRuleVersionRequest {
  /** Must be above every existing version of the rule; `nextVersion` reports it. */
  readonly version: number;
  /** Defaults to true — the ordinary case needs no flag (1.5.1). */
  readonly activate?: boolean;
}

/** A rule created alongside the revision (1.5.2), starting at version 1. */
export interface NewRuleRequest {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly description: string;
  readonly ambiguous: boolean;
  /** Defaults to true, like a new version's. */
  readonly activate?: boolean;
}

/**
 * One revision: the queued version being retired, and what replaces it.
 *
 * Both `newVersion` and `newRule` are optional and at least one is required.
 * 1.5.2 allows all three shapes — a new version of the same rule, a narrowed
 * new version plus a new rule alongside it, or a new rule taking over while the
 * old rule stays parked — and leaves the choice between them to the workflow.
 */
export interface RevisionRequest {
  readonly ruleId: string;
  /** The version carrying `needsReview`, which this revision clears. */
  readonly version: number;
  readonly newVersion?: NewRuleVersionRequest;
  readonly newRule?: NewRuleRequest;
}

/** What one revision wrote. */
export interface RuleRevisionReport {
  readonly ruleId: string;
  /** The version that was reviewed, and whose `needsReview` is now false. */
  readonly reviewedVersion: number;
  /** The version written, or null when the revision wrote none. */
  readonly newVersion: number | null;
  readonly newVersionActivated: boolean;
  /** The rule created alongside (1.5.2), or null when none was. */
  readonly newRuleId: string | null;
  readonly newRuleActivated: boolean;
}

/** The highest version number each rule has, by rule id. */
interface HighestVersion {
  ruleId: string;
  highest: number;
}

/**
 * The revision workflow's read of the queue and its one write.
 *
 * `needsReview` is the queue (1.5.1). `RuleVersionsService` sets it — from
 * Decline on a rule (1.2.6) and from the ticked cross on a row (1.2.8) — and
 * deliberately never clears it, not even when a replacement version is
 * activated, because emptying the queue behind the workflow's back would lose
 * the feedback that drives the revision. This service is the other end of that
 * line: it reads the queue, and clearing an entry happens only as part of
 * actually revising it.
 *
 * Four things the code does not say on its own:
 *
 * - **A revision is one transaction.** The new version, its activation, the
 *   rule created alongside it and the cleared flag land together or not at all.
 *   A half-applied revision would either park a rule with no replacement or
 *   clear the queue entry for a revision that never happened, and both are
 *   states nobody asked for.
 * - **It refuses to write a version the registry has no code for.** This is the
 *   only write path that creates active versions, `(ruleId, version)` is the
 *   key the code is written against (1.1.1), and an active version with no code
 *   aborts the next run (1.1.14) with nothing to point at.
 * - **A revision must write something.** 1.5.1's outcome is a new version, so
 *   an empty request is refused rather than quietly clearing the flag and
 *   leaving the rule parked with no replacement.
 * - **The reviewed version keeps its reason and stays inactive.** 1.5.1 clears
 *   `needsReview` and says nothing about the reason, which is the record of why
 *   the revision happened; a rule is never deleted (1.1.8) and the modification
 *   log keeps pointing at the code that made each past change (1.3).
 *
 * No rule row of any per-source table is touched. The row that exposed the bug
 * stays pending on purpose (1.2.8) so the revised version proposes on exactly
 * that row, and a row already declined stays declined forever (1.2.9) — both
 * are decided by the next run, not here.
 */
@Injectable()
export class RuleRevisionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: RuleRegistry,
  ) {}

  /**
   * Every version waiting to be revised (1.5.1), oldest rule first.
   *
   * One read and no writes: reading the queue is not deciding anything about
   * it. Two queries whatever the queue holds — the versions with their rules,
   * and one grouped statement for the highest version of each rule — rather
   * than a per-entry lookup of the next version number.
   */
  async queue(): Promise<QueuedRevision[]> {
    const waiting = await this.dataSource
      .getRepository(RuleVersion)
      .createQueryBuilder('version')
      // The rule is joined rather than fetched afterwards because every entry
      // needs its name, description and ambiguity: what the version does wrong
      // is only readable beside what the rule claims to do.
      .innerJoinAndSelect('version.rule', 'rule')
      .where('version.needsReview = :needsReview', { needsReview: true })
      .orderBy('version.ruleId', 'ASC')
      .addOrderBy('version.version', 'ASC')
      .getMany();

    const highest = await this.highestVersions();

    return waiting.map((version) => ({
      ruleId: version.ruleId,
      version: version.version,
      reason: version.reason,
      ruleName: version.rule.ruleName,
      description: version.rule.description,
      ambiguous: version.rule.ambiguous,
      nextVersion: (highest.get(version.ruleId) ?? version.version) + 1,
    }));
  }

  /**
   * Applies one revision: writes the next version, activates it, optionally
   * creates a rule alongside it (1.5.2), and clears `needsReview` on the
   * version that was reviewed (1.5.1).
   *
   * Per version, not per rule. "Each is revised" in 1.5.1 is about the queue
   * entries, and one revision never clears another entry's flag — two declined
   * versions of two rules are two calls, and so are two declined versions of
   * one rule.
   */
  async revise(request: RevisionRequest): Promise<RuleRevisionReport> {
    const { ruleId, version, newVersion, newRule } = request;

    if (newVersion === undefined && newRule === undefined) {
      throw new InvalidRevisionError(
        `revising ${ruleId} version ${version} writes nothing: give a new version, a new rule, or both`,
      );
    }

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const versions = manager.getRepository(RuleVersion);
      const reviewed = await versions.findOne({ where: { ruleId, version } });

      if (reviewed === null) {
        throw new UnknownRuleVersionError(ruleId, version);
      }

      if (!reviewed.needsReview) {
        throw new NotQueuedForRevisionError(ruleId, version);
      }

      const newVersionActivated =
        newVersion === undefined ? false : await this.writeVersion(manager, ruleId, newVersion);
      const newRuleActivated =
        newRule === undefined ? false : await this.writeRule(manager, newRule);

      // Last, and only this column: the version stays inactive and keeps the
      // reason it was declined with. Retiring the queue entry is what a
      // revision does, not what it starts with.
      await versions.update({ ruleId, version }, { needsReview: false });

      return {
        ruleId,
        reviewedVersion: version,
        newVersion: newVersion?.version ?? null,
        newVersionActivated,
        newRuleId: newRule?.ruleId ?? null,
        newRuleActivated,
      };
    });
  }

  /**
   * Writes the new version of the rule being revised, and reports whether it
   * was activated.
   *
   * Two checks before the insert, both of which fail the whole revision:
   *
   * - the registry has code for `(ruleId, version)` — the key addresses code
   *   (1.1.1), and this is the only path that makes a version active;
   * - the number is above every existing version of the rule. Versions are
   *   appended, never reused and never renumbered: reusing one would make a
   *   rule row written by the old code read as the new code's (1.3), and going
   *   backwards would make `nextVersion` lie to the next revision.
   */
  private async writeVersion(
    manager: EntityManager,
    ruleId: string,
    request: NewRuleVersionRequest,
  ): Promise<boolean> {
    const { version, activate } = request;

    if (!Number.isInteger(version)) {
      throw new InvalidRevisionError(`${ruleId} version ${version} is not a whole number`);
    }

    // Throws UnregisteredRuleError, which names the missing code rather than
    // the missing row — the two failures send whoever is debugging to
    // different places.
    this.registry.get(ruleId, version);

    const highest = (await this.highestVersions(manager)).get(ruleId);

    if (highest !== undefined && version <= highest) {
      throw new InvalidRevisionError(
        `${ruleId} version ${version} is not above its highest existing version, ${highest}`,
      );
    }

    await manager.insert(RuleVersion, { ruleId, version });

    if (activate === false) {
      return false;
    }

    await activateWithin(manager, ruleId, version);

    return true;
  }

  /**
   * Writes a rule created alongside the revision (1.5.2) and its version 1, and
   * reports whether that version was activated.
   *
   * Version 1 because the rule is new, and the registry is checked for code
   * under that key for the reason `writeVersion` gives.
   *
   * `insert`, never `save`: a rule id already taken is a different rule, and
   * `save` would quietly rewrite its name, description and ambiguity. The id is
   * checked first so the failure says what is wrong with the request, and the
   * insert is what stops a second writer taking the id between the two.
   */
  private async writeRule(manager: EntityManager, request: NewRuleRequest): Promise<boolean> {
    const { ruleId, ruleName, description, ambiguous, activate } = request;

    this.registry.get(ruleId, 1);

    const taken = await manager.getRepository(Rule).findOne({ where: { ruleId } });

    if (taken !== null) {
      throw new InvalidRevisionError(`rule id ${ruleId} is already taken`);
    }

    await manager.insert(Rule, { ruleId, ruleName, description, ambiguous });
    await manager.insert(RuleVersion, { ruleId, version: 1 });

    if (activate === false) {
      return false;
    }

    await activateWithin(manager, ruleId, 1);

    return true;
  }

  /**
   * The highest version number each rule has, in one grouped statement.
   *
   * Takes a manager so the revision reads it inside its own transaction, and
   * defaults to the connection for `queue`, which opens none.
   */
  private async highestVersions(manager?: EntityManager): Promise<Map<string, number>> {
    const repository = (manager ?? this.dataSource).getRepository(RuleVersion);
    const rows = await repository
      .createQueryBuilder('version')
      .select('version.ruleId', 'ruleId')
      .addSelect('MAX(version.version)', 'highest')
      .groupBy('version.ruleId')
      .getRawMany<HighestVersion>();

    // `Number(...)` because an aggregate is not a mapped column: a driver is
    // free to hand MAX() back as a string, and a string compares as text.
    return new Map(rows.map((row) => [row.ruleId, Number(row.highest)]));
  }
}
