import { createDatabase } from "@norbius/db";
import { createLogger } from "@norbius/observability";
import { Redis } from "ioredis";
import { buildApp } from "./app";
import { loadEnv } from "./env";
import { ConsoleMailer, FileMailer, ResendMailer, type Mailer } from "./lib/mailer";

const env = loadEnv();
const log = createLogger({ service: "api", level: env.LOG_LEVEL });
const { db, close } = createDatabase(env.DATABASE_URL);
const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false }) : null;
const mailer: Mailer = env.RESEND_API_KEY
  ? new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM)
  : env.MAIL_OUTBOX_DIR
    ? new FileMailer(env.MAIL_OUTBOX_DIR)
    : new ConsoleMailer(log);

// Dublê do LLM só existe em E2E (APP_ENV=test, validado em loadEnv).
const llm = env.AI_E2E_DOUBLE ? new (await import("./testing/e2e-llm")).E2eLlm() : undefined;
const app = await buildApp({ env, db, mailer, log, redis, llm });

if (env.JOBS_ENABLED) app.jobs.start();

const shutdown = async (signal: string) => {
  log.info({ signal }, "encerrando");
  app.jobs.stop();
  await app.close();
  await close();
  redis?.disconnect();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: env.HOST, port: env.PORT });
