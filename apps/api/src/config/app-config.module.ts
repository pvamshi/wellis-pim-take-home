import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions, type ApiDataSourceOptions } from './database-url';

/**
 * The single place the rest of the app reaches configuration through. Nothing
 * outside this directory reads DATABASE_URL or TURSO_AUTH_TOKEN, and nothing
 * outside it knows which database is on the other end.
 */
@Module({
  imports: [
    // Two paths: `npm run dev -w apps/api` runs with the working directory at
    // apps/api, while the repository's .env sits at the root. Values already in
    // process.env win over the file, which is dotenv's default.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: (): ApiDataSourceOptions & { retryAttempts: number } => {
        const options = buildDataSourceOptions(process.env);

        // Both branches set `driver` now, so the local case is the one whose
        // database is a path rather than a URL. libsql will not create a file in
        // a directory that is not there, and a fresh clone has no data/.
        if (!options.database.startsWith('libsql://')) {
          mkdirSync(dirname(options.database), { recursive: true });
        }

        // One attempt, not ten. Nest's default retry answers a refused
        // connection with "Unable to connect to the database. Retrying (1)...",
        // which names neither the database nor the reason, and then spends
        // thirty seconds doing it again — long enough that a deployed instance
        // reports a timeout instead of the error it already had.
        return { ...options, retryAttempts: 1 };
      },
    }),
  ],
})
export class AppConfigModule {}
