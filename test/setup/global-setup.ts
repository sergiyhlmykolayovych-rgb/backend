import { execSync } from 'node:child_process';
import pg from 'pg';

import { applyTestEnv, getDatabaseName } from './test-env.js';

// Виконується один раз перед усіма e2e-тестами: створює тестову базу (якщо її ще немає)
// і накочує міграції.
export default async function globalSetup() {
  // Вихідна адреса потрібна, щоб підключитись до сервера й створити тестову базу.
  const baseUrl = process.env.DATABASE_URL;
  const databaseUrl = applyTestEnv();
  const databaseName = getDatabaseName(databaseUrl);

  const client = new pg.Client({
    connectionString: process.env.E2E_BASE_DATABASE_URL ?? baseUrl,
  });

  await client.connect();

  try {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName],
    );

    if (existing.rowCount === 0) {
      // Імʼя бази не можна передати параметром; воно походить з нашого ж DATABASE_URL
      // і вже перевірене на суфікс _test.
      await client.query(
        `CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`,
      );
    }
  } finally {
    await client.end();
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl };

  execSync('pnpm exec prisma migrate deploy', { env, stdio: 'pipe' });
}
