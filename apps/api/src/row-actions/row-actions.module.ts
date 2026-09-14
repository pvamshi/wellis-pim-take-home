import { Module } from '@nestjs/common';
import { RowsModule } from '../rows/rows.module';
import { RulesModule } from '../rules/rules.module';
import { RowActionsController } from './row-actions.controller';

/**
 * The four row-wide presses (1.6.4, 1.6.5, 1.6.6).
 *
 * It provides nothing. Approve all and decline all are `RulesModule`'s
 * `RuleApprovalsService` and `RuleRowDeclinesService`, exported from there for
 * exactly this — the same shape `ApproveModule`/`DeclineModule` already keep
 * for the single-finding presses. Reject and un-reject are `RowsModule`'s
 * `RowRejectionsService`, exported from there for the same reason.
 *
 * A sibling of `rows-list/` and `row-detail/` rather than a change to either:
 * neither of those modules imports the rule tables or `RowRejectionsService`
 * this one needs, and their controllers are pinned to the `rows` prefix by
 * their own `@Controller` decorators with routes of their own — a bare `GET`
 * and a two-segment `GET` — so this module's four two-segment `POST`s live
 * beside them without shadowing either.
 */
@Module({
  imports: [RulesModule, RowsModule],
  controllers: [RowActionsController],
})
export class RowActionsModule {}
