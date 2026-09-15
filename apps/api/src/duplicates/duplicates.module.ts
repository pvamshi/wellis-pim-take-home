import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Duplicate } from './duplicate.entity';

/**
 * The one duplicates table.
 *
 * It sits here rather than in `LegacyModule` because that module is the six
 * per-source tables and this one belongs to no single source — it spans all
 * three.
 *
 * This module is not optional structure. The connection runs with
 * `autoLoadEntities: true`, and that only picks up entities registered through
 * `TypeOrmModule.forFeature` — an entity file nobody imports is invisible to the
 * schema sync, so without this module the table never exists.
 *
 * `TypeOrmModule` is re-exported so the repository is injectable from any
 * module that imports this one. There is no provider of its own:
 * `RuleFindingsService` (`rules/rule-findings.service.ts`) is what writes
 * `duplicate` now, in the same transaction as the findings it writes
 * alongside (1.7.2) — which is why `RulesModule` imports this one rather than
 * a service living here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Duplicate])],
  exports: [TypeOrmModule],
})
export class DuplicatesModule {}
