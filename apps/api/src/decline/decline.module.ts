import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { DeclineController } from './decline.controller';

/**
 * The three endpoints behind the cross: the rule-level one (1.2.6), the
 * row-level one with "modify the rule" unticked (1.2.7), and the row-level one
 * with it ticked (1.2.8).
 *
 * It provides nothing. The rule-level press writes `rule_version`, whose one
 * write path is `RulesModule`'s `RuleVersionsService`; the unticked row-level
 * press writes a per-source rule table through that module's
 * `RuleRowDeclinesService` (1.1.3); and the ticked one writes `rule_version`
 * through the same service the rule-level press uses, because 1.2.8 and 1.2.6
 * park a version the identical way. This module is the same shape
 * `ApproveModule` and `ApplyRulesModule` already set, keeping the HTTP surface
 * out of the module that owns the rules tables.
 *
 * The folder is `decline/` rather than `decline-rule/` so every level of the
 * cross has the symmetric home `approve/` already gives both levels of the
 * tick.
 */
@Module({
  imports: [RulesModule],
  controllers: [DeclineController],
})
export class DeclineModule {}
