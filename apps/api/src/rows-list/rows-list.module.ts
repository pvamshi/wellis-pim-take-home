import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { RowsListController } from './rows-list.controller';

/**
 * The one endpoint the rows screen loads (1.6.1, 1.6.2).
 *
 * It provides nothing. The read itself is `RulesModule`'s `RowListService`,
 * which that module exports for exactly this — the same shape
 * `RulesListModule` and `RuleDetailModule` already set, keeping the HTTP
 * surface out of the module that owns the legacy and rule tables.
 *
 * The folder is `rows-list/` rather than `rows/` because that name is taken
 * by the module owning the rejection table (1.6.2, 1.6.6), and a read endpoint
 * of its own mirrors `rules-list/` beside `rules/`.
 */
@Module({
  imports: [RulesModule],
  controllers: [RowsListController],
})
export class RowsListModule {}
