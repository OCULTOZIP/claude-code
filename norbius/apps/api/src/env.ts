import { PRO_AI_MESSAGES_PER_MONTH } from "@norbius/domain";
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true" || v === "1"));

const schema = z
  .object({
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_URL: z.url(),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url().optional(),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET precisa ter pelo menos 32 caracteres"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().default("NORBIUS <nao-responda@norbius.com.br>"),
    AUTH_RATE_LIMIT_ENABLED: bool(true),
    HIBP_ENABLED: z.enum(["true", "false", "1", "0"]).optional(),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
    /** Segredo compartilhado com o SSR do web: limita chamadas internas por sessão, não pelo IP do servidor. */
    INTERNAL_API_SECRET: z.string().min(32, "INTERNAL_API_SECRET precisa ter pelo menos 32 caracteres").optional(),
    /** Só dev/test: grava e-mails como JSON neste diretório (usado pelos testes E2E). */
    MAIL_OUTBOX_DIR: z.string().min(1).optional(),
    /** NORBIUS AI. Sem chave, o assistente fica indisponível (nunca simulado). */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    AI_MODEL: z.string().min(1).default("claude-opus-5"),
    AI_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    AI_MONTHLY_MESSAGE_LIMIT: z.coerce.number().int().min(0).default(PRO_AI_MESSAGES_PER_MONTH),
    /** Somente E2E: dublê determinístico do LLM (proibido fora de APP_ENV=test). */
    AI_E2E_DOUBLE: z.enum(["1"]).optional(),
    /** Voz neural local (Piper, ver tts/server.py). Sem ela, o web usa a voz do navegador. */
    TTS_URL: z.url().optional(),
    AI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(12).default(6),
    /** Assinaturas (Asaas). Sem chave, o checkout fica indisponível (teste grátis continua funcionando). */
    ASAAS_API_KEY: z.string().min(1).optional(),
    ASAAS_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    /** Token que o Asaas envia no cabeçalho `asaas-access-token` de cada webhook. */
    ASAAS_WEBHOOK_TOKEN: z.string().min(32, "ASAAS_WEBHOOK_TOKEN precisa ter pelo menos 32 caracteres").optional(),
    /** Somente E2E: provedor de pagamento falso (proibido fora de APP_ENV=test). */
    BILLING_E2E_FAKE: z.enum(["1"]).optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", message: "Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET juntos." });
    }
    const deployed = env.APP_ENV === "production" || env.APP_ENV === "staging";
    if (deployed && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", message: "RESEND_API_KEY é obrigatória em staging/produção." });
    }
    if (deployed && !env.REDIS_URL) {
      ctx.addIssue({ code: "custom", message: "REDIS_URL é obrigatória em staging/produção (rate limit distribuído)." });
    }
    if (deployed && !env.INTERNAL_API_SECRET) {
      ctx.addIssue({ code: "custom", message: "INTERNAL_API_SECRET é obrigatória em staging/produção (rate limit do SSR)." });
    }
    if (env.AI_E2E_DOUBLE && env.APP_ENV !== "test") {
      ctx.addIssue({ code: "custom", message: "AI_E2E_DOUBLE só pode ser usado com APP_ENV=test." });
    }
    if (env.BILLING_E2E_FAKE && env.APP_ENV !== "test") {
      ctx.addIssue({ code: "custom", message: "BILLING_E2E_FAKE só pode ser usado com APP_ENV=test." });
    }
    if (env.ASAAS_API_KEY && !env.ASAAS_WEBHOOK_TOKEN) {
      ctx.addIssue({ code: "custom", message: "Defina ASAAS_WEBHOOK_TOKEN junto com ASAAS_API_KEY." });
    }
    if (env.APP_ENV === "production" && env.ASAAS_API_KEY && env.ASAAS_ENV !== "production") {
      ctx.addIssue({ code: "custom", message: "Em produção, ASAAS_ENV deve ser production." });
    }
    if (deployed && env.MAIL_OUTBOX_DIR) {
      ctx.addIssue({ code: "custom", message: "MAIL_OUTBOX_DIR não pode ser usado em staging/produção." });
    }
    if (deployed && !env.APP_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", message: "APP_URL deve usar https em staging/produção." });
    }
  })
  .transform((env) => ({
    ...env,
    // Checagem de senhas vazadas (HIBP) ligada por padrão fora de dev/test.
    HIBP_ENABLED:
      env.HIBP_ENABLED === undefined
        ? env.APP_ENV === "production" || env.APP_ENV === "staging"
        : env.HIBP_ENABLED === "true" || env.HIBP_ENABLED === "1",
    googleEnabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  }));

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Variáveis vazias (ex.: `GOOGLE_CLIENT_ID=` no .env) contam como não definidas.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return parsed.data;
}
