import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { DeclineController } from './decline.controller';

/**
 * The two endpoints behind the cross: the rule-level one (1.2.6) and the
 * row-level one with "modify the rule" unticked (1.2.7).
 *
 * It provides nothing. The rule-level press writes `rule_version`, whose one
 * write path is `RulesModule`'s `RuleVersionsService`, and the row-level press
 * writes a per-source rule table through that module's `RuleRowDeclinesService`
 * (1.1.3); this module is the same shape `ApproveModule` and `ApplyRulesModule`
 * already set, keeping the HTTP surface out of the module that owns the rules
 * tables.
 *
 * The folder is `decline/` rather than `decline-rule/` so both levels of the
 * cross have the symmetric home `approve/` already gives both levels of the
 * tick.
 */
@Module({
  imports: [RulesModule],
  controllers: [DeclineController],
})
export class DeclineModule {}
