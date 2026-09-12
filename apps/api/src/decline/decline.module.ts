import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { DeclineController } from './decline.controller';

/**
 * The endpoint behind the rule-level cross (1.2.6).
 *
 * It provides nothing. Declining writes `rule_version`, whose one write path is
 * `RulesModule`'s `RuleVersionsService`; this module is the same shape
 * `ApproveModule` and `ApplyRulesModule` already set, keeping the HTTP surface
 * out of the module that owns the rules tables.
 *
 * The folder is `decline/` rather than `decline-rule/` so the row-level cross
 * (1.2.7) has the same symmetric home `approve/` already gives both levels of
 * the tick.
 */
@Module({
  imports: [RulesModule],
  controllers: [DeclineController],
})
export class DeclineModule {}
