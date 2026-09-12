import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RuleVersion } from './rule-version.entity';
import { RuleVersionsService } from './rule-versions.service';
import { Rule } from './rule.entity';

/**
 * The two rules tables and the one write path onto them.
 *
 * This module is not optional structure. The connection runs with
 * `autoLoadEntities: true`, and that only picks up entities registered through
 * `TypeOrmModule.forFeature` — an entity file nobody imports is invisible to the
 * schema sync, so without this module the tables never exist.
 *
 * `TypeOrmModule` is re-exported so both repositories are injectable from any
 * module that imports this one, rather than every consumer repeating the same
 * `forFeature` list.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Rule, RuleVersion])],
  providers: [RuleVersionsService],
  exports: [TypeOrmModule, RuleVersionsService],
})
export class RulesModule {}
