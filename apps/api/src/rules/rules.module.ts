import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LegacyModule } from '../legacy/legacy.module';
import { RuleApprovalsService } from './rule-approvals.service';
import { ruleCatalogue } from './rule-catalogue';
import { RuleFindingsService } from './rule-findings.service';
import { RuleRegistry } from './rule-registry';
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
 */
@Module({
  imports: [LegacyModule, TypeOrmModule.forFeature([Rule, RuleVersion])],
  providers: [
    RuleVersionsService,
    RuleRunnerService,
    RuleFindingsService,
    RuleApprovalsService,
    { provide: RuleRegistry, useFactory: (): RuleRegistry => new RuleRegistry(ruleCatalogue) },
  ],
  exports: [
    TypeOrmModule,
    RuleVersionsService,
    RuleRegistry,
    RuleRunnerService,
    RuleFindingsService,
    RuleApprovalsService,
  ],
})
export class RulesModule {}
