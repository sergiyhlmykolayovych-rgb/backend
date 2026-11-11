import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // За проксі хостингу (Railway) беремо справжній IP клієнта, інакше ліміт запитів спільний для всіх.
  app.set('trust proxy', 1);

  configureApp(app);

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3002);

  await app.listen(port);
}

void bootstrap();
