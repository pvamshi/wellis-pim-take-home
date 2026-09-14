import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RowRejection } from './row-rejection.entity';
import { RowRejectionsService } from './row-rejections.service';

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
 *
 * `RowRejectionsService` is the write path onto this table (1.6.6) that this
 * module's own comment used to earmark as a later task's — that task is R3.
 * It is exported so `row-actions/`'s controller can inject it, the same
 * out-of-module-HTTP-surface shape every other write path in this codebase
 * already keeps.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RowRejection])],
  providers: [RowRejectionsService],
  exports: [TypeOrmModule, RowRejectionsService],
})
export class RowsModule {}
