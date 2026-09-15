import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { DuplicatesListController } from './duplicates-list.controller';

/**
 * The one endpoint the duplicates screen loads (1.7.4).
 *
 * It provides nothing. The read itself is `RulesModule`'s
 * `DuplicateListService`, which that module exports for exactly this — the
 * same shape `RowsListModule` already sets for `RowListService`.
 *
 * The folder is `duplicates-list/` rather than `duplicates/` because that
 * name is taken by the module owning the `duplicate` table (1.1.13), and a
 * read endpoint of its own mirrors `rows-list/` beside `rows/`.
 */
@Module({
  imports: [RulesModule],
  controllers: [DuplicatesListController],
})
export class DuplicatesListModule {}
