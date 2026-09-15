import { Module } from '@nestjs/common';
import { RulesModule } from '../rules/rules.module';
import { RuleEffectsController } from './rule-effects.controller';

/** The endpoint behind seeing a changed rule's effect (1.5.3); the read is `RulesModule`'s `RuleEffectsService`. */
@Module({
  imports: [RulesModule],
  controllers: [RuleEffectsController],
})
export class RuleEffectsModule {}
