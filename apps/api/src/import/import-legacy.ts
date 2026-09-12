import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LegacyImportService, type LegacyFileReport } from './legacy-import.service';

/**
 * The export sits at the repository root while `npm run import -w apps/api`
 * runs with the working directory at apps/api. Walking up finds it from either,
 * and an explicit path as the first argument overrides the search.
 */
function resolveExportDirectory(argument: string | undefined): string {
  if (argument !== undefined) {
    return argument;
  }

  let directory = process.cwd();

  for (;;) {
    const candidate = join(directory, 'legacy_export');

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error(
        `legacy_export/ was not found at or above ${process.cwd()}. Pass its path as the first argument.`,
      );
    }

    directory = parent;
  }
}

function report(reports: LegacyFileReport[]): void {
  for (const { file, table, read, inserted, skipped } of reports) {
    console.log(`${file} -> ${table}: ${read} read, ${inserted} inserted, ${skipped} skipped`);
  }

  const total = (pick: (line: LegacyFileReport) => number): number =>
    reports.reduce((sum, line) => sum + pick(line), 0);

  console.log(
    `total: ${total((line) => line.read)} read, ` +
      `${total((line) => line.inserted)} inserted, ` +
      `${total((line) => line.skipped)} skipped`,
  );
}

/**
 * The import as a command. The service is the import; this only decides which
 * directory it reads and prints what it returns. It boots the application
 * context rather than opening a connection of its own, so `DATABASE_URL` alone
 * chooses the database, exactly as it does for the api (tech-stack 4.6.1).
 */
async function main(): Promise<void> {
  const exportDirectory = resolveExportDirectory(process.argv[2]);
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    console.log(`importing ${exportDirectory}`);
    report(await context.get(LegacyImportService).importAll(exportDirectory));
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
