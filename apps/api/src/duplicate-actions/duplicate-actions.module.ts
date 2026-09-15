import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { DuplicateActionsController } from './duplicate-actions.controller';

/**
 * Confirm and dismiss (1.7.5, 1.7.6).
 *
 * It provides nothing. The write path is `RulesModule`'s
 * `DuplicateDecisionsService`, exported from there for exactly this — the
 * same shape `ApproveModule`/`DeclineModule` already keep for their own
 * single-finding presses.
 *
 * A sibling of `duplicates-list/` and `duplicate-detail/` rather than a
 * change to either, the same split `row-actions/` keeps from `rows-list/`
 * and `row-detail/`.
 */
@Module({
  imports: [RulesModule],
  controllers: [DuplicateActionsController],
})
export class DuplicateActionsModule {}
