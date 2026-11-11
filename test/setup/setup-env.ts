import { applyTestEnv } from './test-env.js';

// Виконується в кожному тестовому процесі до імпорту застосунку,
// щоб PrismaService підключився саме до тестової бази.
applyTestEnv();
