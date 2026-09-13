import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CatalogueSyncService } from './catalogue-sync.service';

/**
 * Makes the database match the rule catalogue in code.
 *
 * Run after adding or revising a rule. Idempotent, so running it twice is a
 * no-op and an interrupted session is resumed by running it again.
 */
async function main(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const report = await context.get(CatalogueSyncService).sync();
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
