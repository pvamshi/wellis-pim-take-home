import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { RuleDetailController } from './rule-detail.controller';

/**
 * The endpoint behind expanding one rule (1.2.2, 1.2.3).
 *
 * It provides nothing. The read itself is `RulesModule`'s `RuleDetailService`,
 * which that module exports for exactly this — the same shape `RulesListModule`
 * already set, keeping the HTTP surface out of the module that owns the rules
 * tables.
 *
 * It is a sibling of `rules-list/` rather than a second method on it, which is
 * the split that module's own comment names: one endpoint, one module, so the
 * list and the detail can each be read in one file.
 */
@Module({
  imports: [RulesModule],
  controllers: [RuleDetailController],
})
export class RuleDetailModule {}
