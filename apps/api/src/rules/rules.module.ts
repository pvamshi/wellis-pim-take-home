import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LegacyModule } from '../legacy/legacy.module';
import { RowsModule } from '../rows/rows.module';
import { RowDetailService } from './row-detail.service';
import { RowEditService } from './row-edit.service';
import { RowListService } from './row-list.service';
import { RuleApprovalsService } from './rule-approvals.service';
import { ruleCatalogue } from './rule-catalogue';
import { RuleDetailService } from './rule-detail.service';
import { RuleFindingsService } from './rule-findings.service';
import { RuleListService } from './rule-list.service';
import { RuleRegistry } from './rule-registry';
import { RuleRevisionsService } from './rule-revisions.service';
import { RuleRowDeclinesService } from './rule-row-declines.service';
import { RuleRunnerService } from './rule-runner.service';
import { RuleVersion } from './rule-version.entity';
import { RuleVersionsService } from './rule-versions.service';
import { Rule } from './rule.entity';

/**
 * The two rules tables, the one write path onto them, and the map from
 * `(ruleId, version)` to rule code.
 *
 * This module is not optional structure. The connection runs with
 * `autoLoadEntities: true`, and that only picks up entities registered through
 * `TypeOrmModule.forFeature` — an entity file nobody imports is invisible to the
 * schema sync, so without this module the tables never exist.
 *
 * `TypeOrmModule` is re-exported so both repositories are injectable from any
 * module that imports this one, rather than every consumer repeating the same
 * `forFeature` list.
 *
 * `RuleRegistry` is exported for the same reason: the runner injects it and
 * gets from an active `rule_version` row to code without knowing anything about
 * any individual rule (1.1.14). It is built through a factory rather than being
 * an `@Injectable()` of its own, so the catalogue it reads is visible here
 * instead of being a dependency Nest resolves invisibly — and so a test can
 * build one over fake rules with no container at all.
 *
 * `RuleRunnerService` is exported because the endpoint behind "Apply rules"
 * (1.2.10) lives in a module of its own and injects it from here. It needs no
 * `forFeature` of its own: it reads `rule_version`, which this module already
 * registers.
 *
 * `RuleFindingsService` is the other half of that endpoint — the shared API
 * that turns a run into rule rows (1.1.3) — so it is exported for the same
 * reason. It writes the three per-source rule tables, which `LegacyModule`
 * declares, so this module imports that one; the dependency only runs this way,
 * because nothing under `legacy/` imports anything from `rules/`.
 *
 * `RuleApprovalsService` is the rest of that same sentence: 1.1.3 puts the
 * apply transaction in the layer that persists findings, so approving lives
 * beside writing them rather than behind the endpoint. It is exported because
 * the approve endpoints (1.2.4) live in a module of their own, exactly as the
 * runner and the findings writer already do — the HTTP surface stays out of the
 * module that owns the rules tables. It needs no `forFeature` of its own: it
 * reads `rule_version` from here, and the legacy data and rule tables from
 * `LegacyModule`.
 *
 * `RuleRowDeclinesService` is the row-level cross (1.2.7), here for the same
 * reason: the rule tables are written in this layer (1.1.3), and the endpoint
 * that presses it lives in `decline/`. It is deliberately not a method on
 * `RuleVersionsService` — 1.2.7 leaves the rule untouched, so this press must
 * never reach `rule_version` — nor on `RuleApprovalsService`, because a decline
 * is not an approval. It needs no `forFeature` of its own either: the three
 * per-source rule tables come from `LegacyModule`.
 *
 * `RuleListService` is the first read of the same set of tables — the rules
 * screen's list (1.2.1), which joins `rule`, `rule_version` and the three
 * per-source rule tables. It is here for the reason the writers are: the tables
 * are this module's. The endpoint that serves it lives in a module of its own
 * like every other one, so this is exported too, and it needs no `forFeature`
 * of its own either.
 *
 * `RuleRevisionsService` is the far end of the same tables: the revision
 * workflow's read of `needsReview` — which 1.5.1 makes the queue — and the one
 * write that retires an entry from it. It is here because `rule` and
 * `rule_version` are this module's, and because clearing `needsReview` had to
 * live somewhere: `RuleVersionsService.activate` deliberately refuses to do it,
 * since activating a replacement is not the same event as having revised the
 * version that asked for one. It injects `RuleRegistry` from this module too,
 * so a version it is about to activate is checked against the code that key
 * addresses (1.1.1) before the row exists. It is exported for the command that
 * drives it — a batch operation run from a terminal, like the import, with no
 * screen behind it — which is why there is no controller for it.
 *
 * `RuleDetailService` is the second read of the same set of tables — one
 * expanded rule, its pending rows and its approved rows (1.2.2), each showing
 * before and after (1.2.3). It sits beside `RuleListService` for the reason
 * that one is here: the tables are this module's. Its endpoint lives in
 * `rule-detail/`, a sibling of `rules-list/` rather than a second method on it,
 * so this is exported too — and it needs no `forFeature` of its own either:
 * `rule` and `rule_version` are registered here, and the three per-source rule
 * tables by `LegacyModule`.
 *
 * `RowListService` is the rows screen's list (1.6.1, 1.6.2) — a different
 * screen over the same idea, keyed by legacy id rather than by rule. It sits
 * here rather than in a service of its own under `rows/` because it is the
 * same shape of thing `RuleListService` and `RuleDetailService` already are: a
 * read-only aggregator over legacy data, the three per-source rule tables, and
 * (new) the rejection table. That last one is `RowsModule`'s, which is why this
 * module now imports it — the same way it imports `LegacyModule` for the rest.
 * It is exported for the same reason every other read here is: the endpoint
 * that serves it lives in `rows-list/`, a module of its own.
 *
 * `RowDetailService` is `RuleDetailService`'s transpose: one row expanded
 * (1.6.3), gathering findings across every rule instead of one rule's findings
 * across every row. It sits here for the same reason `RowListService` does —
 * the tables are this module's — and needs no `forFeature` of its own either:
 * `rule` is registered here, and the three legacy data tables and the three
 * per-source rule tables by `LegacyModule`. It reads no `RowRejection` at all,
 * unlike `RowListService`, so it needs nothing from `RowsModule` beyond what
 * this module already imports. Its endpoint lives in `row-detail/`, a sibling
 * of `rows-list/` exactly as `rule-detail/` sits beside `rules-list/`, so this
 * is exported too.
 *
 * `RowEditService` is a hand edit (1.6.7): one column of one legacy row,
 * written and recorded as an approved finding under the reserved rule id
 * `HAND-EDIT`, in one transaction. It sits here for the same reason
 * `RuleApprovalsService` does — it writes both a legacy data table and a rule
 * table, the same two tables that service already owns — and needs no
 * `forFeature` of its own: `rule` is registered here (it inserts the reserved
 * rule's row the first time one is ever made), and the legacy data and rule
 * tables come from `LegacyModule`. Its endpoint lives in `row-edit/`, a
 * sibling of `row-actions/` rather than a fifth route there, because that
 * controller's own docstring commits to the four row-wide presses that act on
 * every finding on a row at once — an edit addresses one named column with a
 * supplied value instead. Exported for the same reason every other endpoint's
 * service here is.
 */
@Module({
  imports: [LegacyModule, RowsModule, TypeOrmModule.forFeature([Rule, RuleVersion])],
  providers: [
    RuleVersionsService,
    RuleRunnerService,
    RuleFindingsService,
    RuleApprovalsService,
    RuleRowDeclinesService,
    RuleListService,
    RuleDetailService,
    RuleRevisionsService,
    RowListService,
    RowDetailService,
    RowEditService,
    { provide: RuleRegistry, useFactory: (): RuleRegistry => new RuleRegistry(ruleCatalogue) },
  ],
  exports: [
    TypeOrmModule,
    RuleVersionsService,
    RuleRegistry,
    RuleRunnerService,
    RuleFindingsService,
    RuleApprovalsService,
    RuleRowDeclinesService,
    RuleListService,
    RuleDetailService,
    RuleRevisionsService,
    RowListService,
    RowDetailService,
    RowEditService,
  ],
})
export class RulesModule {}
