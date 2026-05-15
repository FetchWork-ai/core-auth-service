import { PrismaClient } from '@prisma/client';
import { logger } from '../../shared/logger.js';

const prismaClientSingleton = () => {
  return new PrismaClient();
};

declare const globalThis: {
  __prisma: PrismaClient | undefined;
};

export const prisma = globalThis.__prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

export async function connectPrisma() {
  await prisma.$connect();
  logger.info('Prisma connected to database');
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
  logger.info('Prisma disconnected from database');
}