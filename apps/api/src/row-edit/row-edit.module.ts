import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { RowEditController } from './row-edit.controller';

/**
 * The endpoint behind a hand edit (1.6.7).
 *
 * It provides nothing. The write itself is `RulesModule`'s `RowEditService`,
 * which that module exports for exactly this — the same shape every other
 * row endpoint's module already keeps, HTTP surface out of the module that
 * owns the legacy and rule tables.
 *
 * A sibling of `row-actions/`, `row-detail/` and `rows-list/`, not a change to
 * any of them: none of their controllers can reach `RowEditService`'s write
 * path, and `RowActionsController` is pinned to its own four routes by the
 * "row-wide presses" contract its docstring commits to.
 */
@Module({
  imports: [RulesModule],
  controllers: [RowEditController],
})
export class RowEditModule {}
