import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema, withUserContext, type Database } from "@norbius/db";
import type { Logger } from "@norbius/observability";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@norbius/contracts";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import type { AuditLogger } from "./audit";
import { passwordChangedEmail, resetPasswordEmail, verificationEmail } from "./emails";
import type { Mailer } from "./mailer";
import { passwordHasher } from "./password";

/** Versão vigente dos Termos e da Política de Privacidade aceitos no cadastro. */
export const LEGAL_VERSION = "2026-09-26";

// Endpoints do Better Auth que o NORBIUS não expõe (ou expõe por rota própria).
const DISABLED_PATHS = [
  "/update-user", // perfil é atualizado por /api/v1/me/profile
  "/delete-user", // exclusão segue o fluxo LGPD (Fase 8)
  "/delete-user/callback",
  "/change-email",
  "/get-access-token",
  "/refresh-token",
  "/account-info",
  "/link-social",
  "/unlink-account",
];

type AuthDeps = { env: Env; db: Database; mailer: Mailer; audit: AuditLogger; log: Logger };

export function createAuth({ env, db, mailer, audit, log }: AuthDeps) {
  const plugins: BetterAuthPlugin[] = [];
  if (env.HIBP_ENABLED) {
    plugins.push(haveIBeenPwned({ customPasswordCompromisedMessage: "Esta senha apareceu em vazamentos conhecidos. Escolha outra." }));
  }

  const safeAudit = (entry: Parameters<AuditLogger["record"]>[0]) =>
    audit.record(entry).catch((err) => log.error({ err, action: entry.action }, "falha ao gravar auditoria"));

  return betterAuth({
    appName: "NORBIUS",
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    disabledPaths: DISABLED_PATHS,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        authAccounts: schema.authAccounts,
        verifications: schema.verifications,
        rateLimits: schema.rateLimits,
      },
    }),
    user: { modelName: "users" },
    session: {
      modelName: "sessions",
      expiresIn: 60 * 60 * 24 * 30, // 30 dias, renovada com o uso
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
    },
    account: {
      modelName: "authAccounts",
      encryptOAuthTokens: true,
      // Vincula login Google a uma conta existente somente se o e-mail local
      // já tiver sido verificado (evita sequestro de conta).
      accountLinking: { enabled: true, requireLocalEmailVerified: true },
    },
    verification: { modelName: "verifications" },
    rateLimit: {
      enabled: env.AUTH_RATE_LIMIT_ENABLED,
      storage: "database",
      modelName: "rateLimits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 15 * 60, max: 10 },
        "/sign-up/email": { window: 60 * 60, max: 5 },
        "/request-password-reset": { window: 15 * 60, max: 3 },
        "/send-verification-email": { window: 5 * 60, max: 3 },
        "/reset-password": { window: 15 * 60, max: 5 },
        "/change-password": { window: 15 * 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "norbius",
      useSecureCookies: env.APP_URL.startsWith("https://"),
      database: { generateId: "uuid" },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: passwordHasher,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send(resetPasswordEmail(user.email, user.name, url));
      },
      onPasswordReset: async ({ user }) => {
        await safeAudit({ actorType: "user", actorId: user.id, subjectUserId: user.id, action: "auth.password_reset" });
        await mailer.send(passwordChangedEmail(user.email, user.name, `${env.APP_URL}/recuperar-senha`));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        // Todo link de verificação termina na página de confirmação do app,
        // independentemente de onde o envio foi disparado (cadastro, login, reenvio).
        const link = new URL(url);
        link.searchParams.set("callbackURL", "/email-verificado");
        await mailer.send(verificationEmail(user.email, user.name, link.toString()));
      },
      afterEmailVerification: async (user) => {
        await safeAudit({ actorType: "user", actorId: user.id, subjectUserId: user.id, action: "auth.email_verified" });
      },
    },
    socialProviders: env.googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            prompt: "select_account",
          },
        }
      : {},
    plugins,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // O aceite dos Termos e da Política é exigido pelo servidor, não só pela UI.
        if (ctx.path === "/sign-up/email") {
          const body = ctx.body as Record<string, unknown> | undefined;
          if (body?.acceptTerms !== true) {
            throw new APIError("BAD_REQUEST", {
              code: "TERMS_NOT_ACCEPTED",
              message: "É preciso aceitar os Termos e a Política de Privacidade.",
            });
          }
          delete body.acceptTerms;
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await withUserContext(db, user.id, async (tx) => {
              await tx.insert(schema.profiles).values({ userId: user.id, displayName: user.name });
              await tx.insert(schema.consents).values([
                { userId: user.id, kind: "terms", version: LEGAL_VERSION, granted: true },
                { userId: user.id, kind: "privacy", version: LEGAL_VERSION, granted: true },
              ]);
            });
            await safeAudit({ actorType: "user", actorId: user.id, subjectUserId: user.id, action: "auth.sign_up" });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const [user] = await db
              .select({ status: schema.users.status })
              .from(schema.users)
              .where(eq(schema.users.id, session.userId));
            if (!user || user.status !== "active") return false;
          },
          after: async (session) => {
            await db
              .update(schema.users)
              .set({ lastSeenAt: new Date() })
              .where(eq(schema.users.id, session.userId));
            await safeAudit({
              actorType: "user",
              actorId: session.userId,
              subjectUserId: session.userId,
              action: "auth.session_created",
              entityType: "session",
              entityId: session.id,
              ip: session.ipAddress ?? null,
              userAgent: session.userAgent ?? null,
            });
          },
        },
        delete: {
          after: async (session) => {
            await safeAudit({
              actorType: "user",
              actorId: session.userId,
              subjectUserId: session.userId,
              action: "auth.session_revoked",
              entityType: "session",
              entityId: session.id,
            });
          },
        },
      },
    },
    logger: {
      log: (level, message, ...args) => {
        const fn = level === "error" ? log.error : level === "warn" ? log.warn : log.debug;
        fn.call(log, { args }, `[auth] ${message}`);
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
