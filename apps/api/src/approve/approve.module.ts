import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { ApproveController } from './approve.controller';

/**
 * The two endpoints behind Approve (1.2.4), rule-level and row-level.
 *
 * It provides nothing. Applying an accepted change is `RulesModule`'s
 * `RuleApprovalsService`, which lives there because 1.1.3 puts persistence and
 * the apply transaction in one layer; this module is the same shape
 * `ApplyRulesModule` already set, and it keeps the HTTP surface out of the
 * module that owns the rules tables.
 */
@Module({
  imports: [RulesModule],
  controllers: [ApproveController],
})
export class ApproveModule {}
