import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // The web app runs on the Vite dev server at a different origin and calls this
  // api at http://localhost:3000, so without CORS it cannot read the response.
  app.enableCors();

  const port = app.get(ConfigService).get<string | number>('PORT', 3000);
  await app.listen(port);
}

void bootstrap();
