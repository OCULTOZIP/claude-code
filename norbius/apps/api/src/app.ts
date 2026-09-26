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
import { rateLimitKey } from "./lib/rate-limit-key";
import { registerAiRoutes } from "./modules/ai/ai.routes";
import { registerVoiceRoutes } from "./modules/ai/voice.routes";
import { AnthropicLlm, type LlmClient } from "./modules/ai/llm";
import { AsaasProvider } from "./modules/billing/asaas";
import { registerBillingRoutes } from "./modules/billing/billing.routes";
import { BillingService } from "./modules/billing/billing.service";
import { FakeBillingProvider } from "./modules/billing/fake";
import type { BillingProvider } from "./modules/billing/provider";
import { MemoriesService } from "./modules/ai/memories.service";
import { AiOrchestrator } from "./modules/ai/orchestrator";
import { AccountsRepository } from "./modules/accounts/accounts.repository";
import { registerAccountRoutes } from "./modules/accounts/accounts.routes";
import { AccountsService } from "./modules/accounts/accounts.service";
import { registerAuthRoutes } from "./modules/auth/auth.routes";
import { CardsRepository } from "./modules/cards/cards.repository";
import { registerCardRoutes } from "./modules/cards/cards.routes";
import { CardsService } from "./modules/cards/cards.service";
import { registerCategoryRoutes } from "./modules/categories/categories.routes";
import { CategoriesService } from "./modules/categories/categories.service";
import { registerDashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { DashboardService } from "./modules/dashboard/dashboard.service";
import { registerGoalRoutes } from "./modules/goals/goals.routes";
import { GoalsService } from "./modules/goals/goals.service";
import { registerOnboardingRoutes } from "./modules/onboarding/onboarding.routes";
import { OnboardingService } from "./modules/onboarding/onboarding.service";
import { registerRecurringRoutes } from "./modules/recurring/recurring.routes";
import { RecurringService } from "./modules/recurring/recurring.service";
import { TransactionsRepository } from "./modules/transactions/transactions.repository";
import { registerTransactionRoutes } from "./modules/transactions/transactions.routes";
import { TransactionsService } from "./modules/transactions/transactions.service";
import { registerHealthRoutes } from "./modules/health/health.routes";
import { MeRepository } from "./modules/me/me.repository";
import { registerMeRoutes } from "./modules/me/me.routes";
import { MeService } from "./modules/me/me.service";
import { registerErrorHandling } from "./plugins/errors";
import { registerSession } from "./plugins/session";

export type AppDeps = {
  env: Env;
  db: Database;
  mailer: Mailer;
  log: Logger;
  redis: Redis | null;
  llm?: LlmClient | null;
  billingProvider?: BillingProvider | null;
};

export async function buildApp({ env, db, mailer, log, redis, llm, billingProvider }: AppDeps) {
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
    keyGenerator: (req) => rateLimitKey(req, env.INTERNAL_API_SECRET),
    ...(redis ? { redis, nameSpace: "norbius:rl:" } : {}),
  });

  const audit = new AuditLogger(db);
  const auth = createAuth({ env, db, mailer, audit, log });
  const requireUser = registerSession(app, auth);

  registerHealthRoutes(app, db, redis);
  registerAuthRoutes(app, auth, env);
  registerMeRoutes(app, new MeService(new MeRepository(db), audit), requireUser);

  // Núcleo financeiro (composição manual de dependências; sem container de DI).
  const accountsRepo = new AccountsRepository();
  const transactionsRepo = new TransactionsRepository();
  const cardsRepo = new CardsRepository();
  const transactions = new TransactionsService(db, transactionsRepo, accountsRepo, audit);
  const cards = new CardsService(db, cardsRepo, accountsRepo, transactionsRepo, audit);
  // Assinaturas: sem provedor configurado, só o teste grátis funciona (checkout responde 503).
  const provider =
    billingProvider !== undefined
      ? billingProvider
      : env.BILLING_E2E_FAKE
        ? new FakeBillingProvider(env.APP_URL)
        : env.ASAAS_API_KEY
          ? new AsaasProvider(env.ASAAS_API_KEY, env.ASAAS_ENV, log)
          : null;
  const billing = new BillingService(db, provider, audit, log);
  registerBillingRoutes(app, billing, requireUser, { webhookToken: env.ASAAS_WEBHOOK_TOKEN, providerName: provider?.name ?? null });
  const goals = new GoalsService(db, audit, billing);
  const recurring = new RecurringService(db, accountsRepo, cardsRepo, transactions, cards, audit);
  const accountsService = new AccountsService(db, accountsRepo, audit);
  const categories = new CategoriesService(db);
  registerAccountRoutes(app, accountsService, requireUser);
  registerCategoryRoutes(app, categories, requireUser);
  registerTransactionRoutes(app, transactions, requireUser);
  registerCardRoutes(app, cards, requireUser);
  registerRecurringRoutes(app, recurring, requireUser);
  registerGoalRoutes(app, goals, requireUser);
  registerOnboardingRoutes(app, new OnboardingService(db, accountsRepo, cards, recurring, goals, audit), requireUser);
  const dashboard = new DashboardService(db, accountsRepo, cardsRepo, cards, goals);
  registerDashboardRoutes(app, dashboard, requireUser);

  // NORBIUS AI: sem chave configurada o assistente fica indisponível (nunca simulado).
  const memories = new MemoriesService(db);
  const llmClient = llm !== undefined ? llm : env.ANTHROPIC_API_KEY ? new AnthropicLlm(env) : null;
  const ai = new AiOrchestrator(
    db,
    llmClient,
    { accounts: accountsService, categories, transactions, cards, goals, recurring, dashboard, memories, audit, billing },
    env,
    log,
  );
  registerAiRoutes(app, ai, memories, requireUser, llmClient?.model ?? env.AI_MODEL);
  registerVoiceRoutes(app, requireUser, env.TTS_URL);

  return app;
}
