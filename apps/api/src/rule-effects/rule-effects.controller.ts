import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  RuleEffectsService,
  RuleEffectsVersionError,
  type RuleEffects,
} from '../rules/rule-effects.service';

export type RuleEffectsResponse = RuleEffects;

function readVersion(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;

  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new BadRequestException(`${name} must be a whole number of 1 or more`);
  }

  return version;
}

/**
 * What a changed rule would do to the current data (1.5.3). A GET, because it
 * writes nothing: both versions run and the difference comes back. `to`
 * defaults to the rule's newest version in code, `from` to the one before it.
 */
@Controller('rules')
export class RuleEffectsController {
  constructor(private readonly service: RuleEffectsService) {}

  @Get(':ruleId/effects')
  async effects(
    @Param('ruleId') ruleId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<RuleEffectsResponse> {
    let effects: RuleEffects | null;

    try {
      effects = await this.service.effects(
        ruleId,
        readVersion(from, 'from'),
        readVersion(to, 'to'),
      );
    } catch (error) {
      if (error instanceof RuleEffectsVersionError) throw new BadRequestException(error.message);
      throw error;
    }

    if (effects === null) {
      throw new NotFoundException(`there is no rule code for "${ruleId}"`);
    }

    return effects;
  }
}
