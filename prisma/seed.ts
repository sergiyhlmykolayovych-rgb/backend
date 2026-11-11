import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

import { PrismaClient } from '../src/generated/prisma/client.js';

// Створює власника сайту, якщо в базі ще немає жодного користувача.
// Дані беруться зі змінних середовища на момент запуску: у репозиторій їх не коммітять.
async function main() {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;

  if (!email || !password) {
    throw new Error('OWNER_EMAIL and OWNER_PASSWORD must be set to seed the owner');
  }

  if (password.length < 8) {
    throw new Error('OWNER_PASSWORD must be at least 8 characters long');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    if ((await prisma.user.count()) > 0) {
      console.log('Користувач уже існує, сід нічого не змінює.');

      return;
    }

    await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        firstName: process.env.OWNER_FIRST_NAME?.trim() || 'Архітектор',
        lastName: process.env.OWNER_LAST_NAME?.trim() || 'Власник',
      },
    });

    console.log(`Власника ${email} створено.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
