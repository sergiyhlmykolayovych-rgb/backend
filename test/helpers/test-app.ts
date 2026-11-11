import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types.js';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { assertTestDatabase } from '../setup/test-env.js';

export const API_PREFIX = '/api/v1';

export const OWNER_EMAIL = 'owner@example.com';
export const OWNER_PASSWORD = 'owner-password-1';

const DATA_TABLES = [
  'refresh_tokens',
  'users',
  'project_images',
  'project_requests',
  'projects',
  'contact_messages',
  'purchases',
];

export interface ApiClient {
  get: (url: string) => request.Test;
  post: (url: string) => request.Test;
  patch: (url: string) => request.Test;
  put: (url: string) => request.Test;
  delete: (url: string) => request.Test;
}

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
  /** Запит від відвідувача сайту: без входу */
  visitor: ApiClient;
  resetData: () => Promise<void>;
  /** Створює власника й повертає клієнт із його токеном */
  loginAsOwner: () => Promise<ApiClient>;
  close: () => Promise<void>;
}

// customize дозволяє підмінити частину застосунку в конкретному тесті (наприклад, Telegram).
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestApp> {
  assertTestDatabase(process.env.DATABASE_URL ?? '');

  const builder = Test.createTestingModule({
    imports: [AppModule],
  });

  const moduleRef = await (customize ? customize(builder) : builder).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();

  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const server = () => request(app.getHttpServer());

  const client = (token?: string): ApiClient => {
    const withToken = (test: request.Test) =>
      token ? test.set('Authorization', `Bearer ${token}`) : test;

    return {
      get: (url) => withToken(server().get(API_PREFIX + url)),
      post: (url) => withToken(server().post(API_PREFIX + url)),
      patch: (url) => withToken(server().patch(API_PREFIX + url)),
      put: (url) => withToken(server().put(API_PREFIX + url)),
      delete: (url) => withToken(server().delete(API_PREFIX + url)),
    };
  };

  return {
    app,
    prisma,
    visitor: client(),
    resetData: async () => {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${DATA_TABLES.map((table) => `"${table}"`).join(', ')} CASCADE`,
      );
    },
    loginAsOwner: async () => {
      await prisma.user.create({
        data: {
          email: OWNER_EMAIL,
          passwordHash: await bcrypt.hash(OWNER_PASSWORD, 4),
          firstName: 'Тест',
          lastName: 'Власник',
        },
      });

      const response = await server()
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD })
        .expect(201);

      return client(response.body.accessToken as string);
    },
    close: () => app.close(),
  };
}

// Найменший справжній PNG (1×1 піксель) для перевірки завантаження фото.
export const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
