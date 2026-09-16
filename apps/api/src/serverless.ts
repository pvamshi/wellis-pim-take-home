import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * The deployed entry point. `main.ts` is still the one that listens on a port;
 * this one hands the same Nest app to a platform that owns the server itself.
 *
 * Two differences from `main.ts`, both forced by the deployment and neither
 * true locally:
 *
 * - Every route is under `/api`, because the web app and this API share one
 *   origin there and the static site owns `/`. `VITE_API_BASE_URL=/api` is the
 *   other half of that agreement.
 * - The app is built once per warm instance and kept. A cold start pays for
 *   `synchronize` and the two `CREATE TRIGGER IF NOT EXISTS` statements again,
 *   which is why both have to be no-ops against a database that already has
 *   the schema — they are.
 */
let cached: Promise<Handler> | null = null;

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function boot(): Promise<Handler> {
  // TypeORM's better-sqlite3 driver reads `database` as a path and creates its
  // parent directory, so a `libsql://` URL has it making a directory literally
  // named `libsql:` beside the process. Everything here is read-only but the
  // temp directory, and the refused mkdir surfaces only as "Unable to connect
  // to the database" — a sentence about the database that is really about the
  // filesystem. So the process works from somewhere it is allowed to write.
  process.chdir(tmpdir());

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors();
  await app.init();

  return app.getHttpAdapter().getInstance() as Handler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let server: Handler;

  try {
    server = await (cached ??= boot());
  } catch (cause) {
    // A boot that throws has to say what threw. Left to the platform it is an
    // opaque 500 that names neither the module that would not load nor the
    // database that refused the connection. The failed attempt is dropped so
    // the next request tries again instead of replaying this rejection.
    cached = null;
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'the api did not start', detail: String(cause) }));
    return;
  }

  server(req, res);
}
