import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ruleCatalogue } from './rule-catalogue';
import { RuleRegistry } from './rule-registry';
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
 */
@Module({
  imports: [TypeOrmModule.forFeature([Rule, RuleVersion])],
  providers: [
    RuleVersionsService,
    { provide: RuleRegistry, useFactory: (): RuleRegistry => new RuleRegistry(ruleCatalogue) },
  ],
  exports: [TypeOrmModule, RuleVersionsService, RuleRegistry],
})
export class RulesModule {}
