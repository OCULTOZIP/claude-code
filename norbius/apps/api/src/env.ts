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
    /** Só dev/test: grava e-mails como JSON neste diretório (usado pelos testes E2E). */
    MAIL_OUTBOX_DIR: z.string().min(1).optional(),
    /** NORBIUS AI. Sem chave, o assistente fica indisponível (nunca simulado). */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    AI_MODEL: z.string().min(1).default("claude-opus-5"),
    AI_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    AI_MONTHLY_MESSAGE_LIMIT: z.coerce.number().int().min(0).default(100),
    AI_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(12).default(6),
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
