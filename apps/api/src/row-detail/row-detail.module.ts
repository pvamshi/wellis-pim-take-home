import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { RowDetailController } from './row-detail.controller';

/**
 * The endpoint behind expanding one row (1.6.3).
 *
 * It provides nothing. The read itself is `RulesModule`'s `RowDetailService`,
 * which that module exports for exactly this — the same shape
 * `RuleDetailModule` already set, keeping the HTTP surface out of the module
 * that owns the legacy and rule tables.
 *
 * It is a sibling of `rows-list/` rather than a second method on it, which is
 * the split `rule-detail/` already keeps beside `rules-list/`.
 */
@Module({
  imports: [RulesModule],
  controllers: [RowDetailController],
})
export class RowDetailModule {}
