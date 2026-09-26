import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Painel admin (Fase 7, ADR 0007). Identidade SEPARADA dos usuários finais:
// estas tabelas só são acessíveis pelo papel `norbius_admin` (a aplicação não
// tem GRANT). O papel admin não tem GRANT em nenhuma tabela financeira.

export const ADMIN_ROLES = ["support", "billing", "analyst", "superadmin"] as const;
export const SUPPORT_SCOPES = ["transactions:read"] as const;

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role", { enum: ADMIN_ROLES }).notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Segredo TOTP cifrado (AES-256-GCM, chave ADMIN_ENCRYPTION_KEY). */
    totpSecret: text("totp_secret").notNull(),
    /** Último passo TOTP aceito: impede reutilizar o mesmo código. */
    totpLastStep: integer("totp_last_step").notNull().default(0),
    active: boolean("active").notNull().default(true),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("admin_users_role_check", sql`${t.role} in ('support','billing','analyst','superadmin')`),
    check("admin_users_email_check", sql`${t.email} = lower(${t.email})`),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    /** SHA-256 do token do cookie (o token em si nunca é guardado). */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_sessions_admin_idx").on(t.adminUserId)],
);

/** Acesso excepcional criado PELO USUÁRIO (escopado, com prazo, revogável). */
export const supportAccessGrants = pgTable(
  "support_access_grants",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").array().notNull(),
    reason: text("reason").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("support_access_grants_user_idx").on(t.userId, t.grantedAt.desc()),
    check("support_access_grants_scope_check", sql`${t.scope} <@ array['transactions:read']::text[] and cardinality(${t.scope}) > 0`),
    check("support_access_grants_reason_check", sql`char_length(${t.reason}) between 5 and 300`),
    check("support_access_grants_expiry_check", sql`${t.expiresAt} > ${t.grantedAt} and ${t.expiresAt} <= ${t.grantedAt} + interval '7 days'`),
    pgPolicy("support_access_grants_owner", {
      for: "all",
      to: "norbius_app",
      using: sql`user_id = nullif(current_setting('app.user_id', true), '')::uuid`,
      withCheck: sql`user_id = nullif(current_setting('app.user_id', true), '')::uuid`,
    }),
    // O painel admin lista as autorizações (sem dados financeiros) para saber o que pode abrir.
    pgPolicy("support_access_grants_admin_read", { for: "select", to: "norbius_admin", using: sql`true` }),
  ],
).enableRLS();
