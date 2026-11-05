import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton — PostgreSQL (Neon) in production.
 *
 * - The client is cached on globalThis in EVERY environment: in local
 *   development it survives HMR reloads, and on Vercel each warm
 *   serverless invocation reuses the instance instead of opening a new
 *   connection per request. Cold instances get their own.
 * - Connections: runtime always uses the POOLED DATABASE_URL
 *   (Neon "…-pooler…" host + pgbouncer=true). Migration commands
 *   (prisma migrate deploy / diff / studio) automatically use the
 *   DIRECT_DATABASE_URL declared in prisma/schema.prisma — DDL must
 *   never travel through PgBouncer transaction pooling.
 * - Query logging stays in development only: it would bloat serverless
 *   logs (and could leak row data) in production.
 */
const createPrismaClient = () =>
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["query", "error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = db;