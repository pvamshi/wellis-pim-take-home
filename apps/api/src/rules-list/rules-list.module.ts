import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { RulesListController } from './rules-list.controller';

/**
 * The one endpoint the rules screen loads (1.2.1).
 *
 * It provides nothing. The read itself is `RulesModule`'s `RuleListService`,
 * which that module exports for exactly this — the same shape
 * `ApplyRulesModule`, `ApproveModule` and `DeclineModule` already set, keeping
 * the HTTP surface out of the module that owns the rules tables.
 *
 * The folder is `rules-list/` rather than `rules/` because that name is taken
 * by the layer this one calls, and a read endpoint of its own is what makes the
 * rule detail endpoint (1.2.2) a sibling rather than a second method here.
 */
@Module({
  imports: [RulesModule],
  controllers: [RulesListController],
})
export class RulesListModule {}
