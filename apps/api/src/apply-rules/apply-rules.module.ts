import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { ApplyRulesController } from './apply-rules.controller';

/**
 * The one endpoint "Apply rules" calls (1.2.10).
 *
 * It provides nothing. Both halves of the press — the runner and the findings
 * writer — are `RulesModule`'s, which exports them for exactly this; a module
 * of its own is what that module's own doc comment anticipates, and it keeps
 * the HTTP surface out of the module that owns the rules tables.
 */
@Module({
  imports: [RulesModule],
  controllers: [ApplyRulesController],
})
export class ApplyRulesModule {}
