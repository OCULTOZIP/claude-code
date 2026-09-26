import { createDatabase } from "@norbius/db";
import { createLogger } from "@norbius/observability";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app";
import { loadEnv } from "../src/env";
import { MemoryMailer } from "../src/lib/mailer";
import type { LlmClient } from "../src/modules/ai/llm";
import type { BillingProvider } from "../src/modules/billing/provider";

export const APP_URL = "http://localhost:3000";

export async function createTestApp(
  overrides: Record<string, string> = {},
  deps: { llm?: LlmClient | null; billingProvider?: BillingProvider | null } = {},
) {
  const env = loadEnv({
    APP_ENV: "test",
    APP_URL,
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://norbius_app:norbius_app@localhost:5432/norbius",
    BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters!!",
    AUTH_RATE_LIMIT_ENABLED: "false",
    LOG_LEVEL: "silent",
    ...overrides,
  });
  const database = createDatabase(env.DATABASE_URL, { max: 5 });
  const mailer = new MemoryMailer();
  const app = await buildApp({
    env,
    db: database.db,
    mailer,
    log: createLogger({ service: "api-test", level: "silent" }),
    redis: null,
    llm: deps.llm ?? null,
    billingProvider: deps.billingProvider ?? null,
  });
  await app.ready();
  return {
    app,
    mailer,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

/** Cliente HTTP mínimo que guarda cookies entre requisições, como um navegador. */
export class TestClient {
  private cookies = new Map<string, string>();
  constructor(private readonly app: FastifyInstance) {}

  async request(opts: InjectOptions & { url: string }) {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await this.app.inject({
      ...opts,
      headers: { origin: APP_URL, ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
    });
    const setCookie = res.headers["set-cookie"];
    for (const c of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [pair, ...attrs] = c.split(";");
      const idx = pair!.indexOf("=");
      const name = pair!.slice(0, idx).trim();
      const value = pair!.slice(idx + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  get(url: string) {
    return this.request({ method: "GET", url });
  }
  post(url: string, payload?: unknown) {
    return this.request({ method: "POST", url, payload: (payload ?? {}) as object });
  }
  patch(url: string, payload?: unknown) {
    return this.request({ method: "PATCH", url, payload: (payload ?? {}) as object });
  }
  hasSession() {
    return [...this.cookies.keys()].some((k) => k.includes("session_token"));
  }
}

export function uniqueEmail(tag: string) {
  return `${tag}-${crypto.randomUUID().slice(0, 8)}@test.norbius`;
}

export function extractLink(text: string) {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error("link não encontrado no e-mail");
  return new URL(match[0]);
}

/** Cadastra, verifica e devolve um cliente autenticado. */
export async function verifiedClient(ctx: { app: FastifyInstance; mailer: MemoryMailer }, tag: string) {
  const client = new TestClient(ctx.app);
  const email = uniqueEmail(tag);
  const res = await client.post("/api/auth/sign-up/email", {
    name: "Teste",
    email,
    password: "senha-muito-forte-123",
    acceptTerms: true,
  });
  if (res.statusCode !== 200) throw new Error(`cadastro falhou: ${res.body}`);
  const link = extractLink(ctx.mailer.lastTo(email)!.text);
  await client.get(link.pathname + link.search);
  if (!client.hasSession()) throw new Error("verificação não abriu sessão");
  return { client, email };
}

/** Cliente verificado com o teste grátis do Pro ativo (assistente liberado). */
export async function proClient(ctx: { app: FastifyInstance; mailer: MemoryMailer }, tag: string) {
  const r = await verifiedClient(ctx, tag);
  const trial = await r.client.post("/api/v1/billing/trial");
  if (trial.statusCode !== 200) throw new Error(`teste grátis falhou: ${trial.body}`);
  return r;
}
