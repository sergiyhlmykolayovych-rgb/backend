import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Joi from 'joi';

import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { SummaryModule } from './summary/summary.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().uri().required(),

        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),

        // Адреси публічного сайту й адмінки: дозволені origin для CORS.
        SITE_URL: Joi.string().required(),
        ADMIN_URL: Joi.string().required(),

        PORT: Joi.number().port().default(3002),

        // Бот для продажу проєктів. Без цих змінних бот вимкнений, решта працює як завжди.
        TELEGRAM_BOT_TOKEN: Joi.string().allow('').optional(),
        TELEGRAM_BOT_USERNAME: Joi.string().allow('').optional(),
      }).unknown(true),
    }),

    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60_000,
          limit: 100,
        },
      ],
      // E2E-тести роблять сотні запитів з однієї адреси за секунди.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),

    PrismaModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    RequestsModule,
    MessagesModule,
    SummaryModule,
    TelegramModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
