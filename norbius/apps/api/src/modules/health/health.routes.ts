import type { Database } from "@norbius/db";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";

export function registerHealthRoutes(app: FastifyInstance, db: Database, redis: Redis | null) {
  // Liveness: o processo está de pé.
  app.get("/api/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  // Readiness: dependências respondem.
  app.get("/api/ready", { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Record<string, "ok" | "fail"> = {};
    checks.database = await db
      .execute(sql`select 1`)
      .then(() => "ok" as const)
      .catch(() => "fail" as const);
    if (redis) {
      checks.redis = await redis
        .ping()
        .then(() => "ok" as const)
        .catch(() => "fail" as const);
    }
    const ok = Object.values(checks).every((c) => c === "ok");
    return reply.status(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", checks });
  });
}
