import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RowRejection } from './row-rejection.entity';

/**
 * The one rejection table (1.6.2, 1.6.6).
 *
 * It sits here rather than in `LegacyModule` because that module is the six
 * per-source tables and this one belongs to no single source — it spans all
 * three, the same reasoning `DuplicatesModule` gives for `Duplicate`.
 *
 * This module is not optional structure. The connection runs with
 * `autoLoadEntities: true`, and that only picks up entities registered through
 * `TypeOrmModule.forFeature` — an entity file nobody imports is invisible to
 * the schema sync, so without this module the table never exists.
 *
 * `TypeOrmModule` is re-exported so the repository is injectable from any
 * module that imports this one — `RulesModule`, for `RowListService`, exactly
 * as it already imports `LegacyModule` for the six per-source repositories.
 * There is no provider here: the write path onto this table (1.6.6) is a later
 * task's, not this one's.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RowRejection])],
  exports: [TypeOrmModule],
})
export class RowsModule {}
