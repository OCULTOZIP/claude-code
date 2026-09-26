import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { Database } from "@norbius/db";
import type { Logger } from "@norbius/observability";
import Fastify, { type FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { Env } from "./env";
import { AuditLogger } from "./lib/audit";
import { createAuth } from "./lib/auth";
import type { Mailer } from "./lib/mailer";
import { registerAuthRoutes } from "./modules/auth/auth.routes";
import { registerHealthRoutes } from "./modules/health/health.routes";
import { MeRepository } from "./modules/me/me.repository";
import { registerMeRoutes } from "./modules/me/me.routes";
import { MeService } from "./modules/me/me.service";
import { registerErrorHandling } from "./plugins/errors";
import { registerSession } from "./plugins/session";

export type AppDeps = { env: Env; db: Database; mailer: Mailer; log: Logger; redis: Redis | null };

export async function buildApp({ env, db, mailer, log, redis }: AppDeps) {
  const app = Fastify({
    loggerInstance: log as FastifyBaseLogger,
    // Confia apenas nos N proxies imediatos (proxy do web / load balancer).
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
    bodyLimit: 64 * 1024,
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    },
    disableRequestLogging: env.APP_ENV === "test",
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  registerErrorHandling(app);
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-origin" } });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    ...(redis ? { redis, nameSpace: "norbius:rl:" } : {}),
  });

  const audit = new AuditLogger(db);
  const auth = createAuth({ env, db, mailer, audit, log });
  const requireUser = registerSession(app, auth);

  registerHealthRoutes(app, db, redis);
  registerAuthRoutes(app, auth, env);
  registerMeRoutes(app, new MeService(new MeRepository(db), audit), requireUser);

  return app;
}
