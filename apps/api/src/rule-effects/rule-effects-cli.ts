import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RuleEffectsService, type RuleEffects } from '../rules/rule-effects.service';

const USAGE = 'usage: just rule-effects <ruleId> [<ruleId> …]';

/** A rule id the command could not answer for, in place of its effects. */
interface RuleEffectsProblem {
  readonly ruleId: string;
  readonly problem: string;
}

/**
 * What a changed rule would do (1.5.3), from a terminal.
 *
 * The same answer as `GET /rules/:ruleId/effects`, for when no API is running:
 * the revision workflow rebuilds the API underneath `just dev`, so the
 * rule-effects workflow it hands over to cannot count on one. Each rule's
 * newest version in code is compared with the one before it, and nothing is
 * written.
 *
 * Prints one JSON array, an entry per rule id in the order given. A rule with no
 * code is `{ ruleId, problem }` rather than a failure, so one bad id does not
 * hide the answers for the others.
 */
async function main(): Promise<void> {
  const ruleIds = process.argv.slice(2);

  if (ruleIds.length === 0) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const service = context.get(RuleEffectsService);
    const answers: Array<RuleEffects | RuleEffectsProblem> = [];

    for (const ruleId of ruleIds) {
      const effects = await service.effects(ruleId);
      answers.push(effects ?? { ruleId, problem: `there is no rule code for "${ruleId}"` });
    }

    console.log(JSON.stringify(answers, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
