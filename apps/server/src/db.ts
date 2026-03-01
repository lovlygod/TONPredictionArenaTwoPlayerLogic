import { PrismaClient } from "@prisma/client";

type PrismaClientWithBeta = PrismaClient & {
  betaWhitelist: any;
  betaCodesUsed: any;
};

export const prisma = new PrismaClient() as PrismaClientWithBeta;

export async function initSqlitePragmas(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL;");
  await prisma.$executeRawUnsafe("PRAGMA temp_store = MEMORY;");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
}
