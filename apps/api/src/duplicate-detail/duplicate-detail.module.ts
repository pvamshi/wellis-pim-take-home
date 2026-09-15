import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { DuplicateDetailController } from './duplicate-detail.controller';

/**
 * The endpoint behind expanding one link (1.7.4).
 *
 * It provides nothing. The read itself is `RulesModule`'s
 * `DuplicateDetailService`, exported from there for exactly this — the same
 * shape `RowDetailModule` already sets.
 */
@Module({
  imports: [RulesModule],
  controllers: [DuplicateDetailController],
})
export class DuplicateDetailModule {}
