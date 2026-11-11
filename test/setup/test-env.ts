import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';

const TEST_DATABASE_SUFFIX = '_test';

// Тести ніколи не працюють з робочою базою: з DATABASE_URL береться та сама адреса
// сервера, але база з суфіксом _test. Її можна задати й явно через TEST_DATABASE_URL.
export function getTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  const baseUrl = process.env.E2E_BASE_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!baseUrl) {
    throw new Error(
      'DATABASE_URL is not configured: e2e tests need a database',
    );
  }

  const url = new URL(baseUrl);
  const databaseName = url.pathname.replace(/^\//, '');

  if (!databaseName.endsWith(TEST_DATABASE_SUFFIX)) {
    url.pathname = `/${databaseName}${TEST_DATABASE_SUFFIX}`;
  }

  return url.toString();
}

export function getDatabaseName(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.replace(/^\//, '');
}

// Запобіжник від запуску руйнівних операцій (TRUNCATE) не на тестовій базі.
export function assertTestDatabase(databaseUrl: string) {
  const databaseName = getDatabaseName(databaseUrl);

  if (!databaseName.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to run e2e tests against "${databaseName}": database name must end with "${TEST_DATABASE_SUFFIX}"`,
    );
  }
}

export function applyTestEnv() {
  // Запамʼятовуємо вихідну адресу, бо нижче DATABASE_URL підміняється тестовою.
  process.env.E2E_BASE_DATABASE_URL ??= process.env.DATABASE_URL;

  const databaseUrl = getTestDatabaseUrl();

  assertTestDatabase(databaseUrl);

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.SITE_URL = 'http://localhost:3000';
  process.env.ADMIN_URL = 'http://localhost:3003';
  process.env.JWT_ACCESS_SECRET =
    'e2e-access-secret-0123456789abcdef0123456789';
  process.env.JWT_REFRESH_SECRET =
    'e2e-refresh-secret-0123456789abcdef0123456789';

  // Тести ніколи не пишуть у справжнє сховище R2, не шлють повідомлень справжньому боту
  // й не проходять перевірку «я не робот», навіть якщо ключі є в .env.
  // Саме порожній рядок, а не delete: видалену змінну ConfigModule повернув би з .env.
  for (const name of [
    'R2_ENDPOINT',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_USERNAME',
    'TELEGRAM_CHAT_ID',
    'TELEGRAM_PAYMENT_PROVIDER_TOKEN',
    'TELEGRAM_PAYMENT_CURRENCY',
    'TELEGRAM_POLLING',
    'TELEGRAM_WEBHOOK_URL',
    'TURNSTILE_SECRET_KEY',
  ]) {
    process.env[name] = '';
  }

  // Файли тести пишуть у тимчасову папку, а не в проєкт.
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'architect-api-e2e-uploads');

  return databaseUrl;
}
