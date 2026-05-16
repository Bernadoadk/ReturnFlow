import { PrismaClient } from "@prisma/client";

declare global {
  var __db__: PrismaClient | undefined;
}

// Reuse a single PrismaClient across all invocations (prod and dev).
// In production on Vercel/serverless, each module is re-evaluated per cold start
// but the global persists within a warm instance, avoiding connection pool exhaustion.
if (!global.__db__) {
  global.__db__ = new PrismaClient();
}

const prisma = global.__db__;

export default prisma;
