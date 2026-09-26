import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  inet,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// Toda tabela de domínio do usuário tem RLS: só enxerga linhas cujo user_id é
// o do contexto definido pela API (`app.user_id`, ver withUserContext).
const ownRows = sql`user_id = nullif(current_setting('app.user_id', true), '')::uuid`;

const userOwned = (table: string) =>
  pgPolicy(`${table}_owner`, { for: "all", to: "norbius_app", using: ownRows, withCheck: ownRows });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const profiles = pgTable(
  "profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    locale: text("locale").notNull().default("pt-BR"),
    avgMonthlyIncomeCents: bigint("avg_monthly_income_cents", { mode: "number" }),
    incomeFrequency: text("income_frequency", {
      enum: ["monthly", "biweekly", "weekly", "irregular"],
    }),
    incomeDays: smallint("income_days").array(),
    onboardingStatus: text("onboarding_status", {
      enum: ["not_started", "in_progress", "completed", "skipped"],
    })
      .notNull()
      .default("not_started"),
    onboardingStep: text("onboarding_step"),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    // Rascunho do onboarding (retomável em qualquer dispositivo); apagado ao concluir.
    onboardingDraft: jsonb("onboarding_draft"),
    preferences: jsonb("preferences").notNull().default({}),
    ...timestamps,
  },
  (t) => [
    userOwned("profiles"),
    check("profiles_income_check", sql`${t.avgMonthlyIncomeCents} is null or ${t.avgMonthlyIncomeCents} >= 0`),
    check(
      "profiles_income_frequency_check",
      sql`${t.incomeFrequency} is null or ${t.incomeFrequency} in ('monthly','biweekly','weekly','irregular')`,
    ),
    check(
      "profiles_onboarding_status_check",
      sql`${t.onboardingStatus} in ('not_started','in_progress','completed','skipped')`,
    ),
    check("profiles_display_name_length_check", sql`char_length(${t.displayName}) <= 80`),
  ],
).enableRLS();

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["terms", "privacy", "marketing_email", "ai_processing"] }).notNull(),
    version: text("version").notNull(),
    granted: boolean("granted").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    ip: inet("ip"),
  },
  (t) => [
    index("consents_user_id_idx").on(t.userId),
    userOwned("consents"),
    check("consents_kind_check", sql`${t.kind} in ('terms','privacy','marketing_email','ai_processing')`),
  ],
).enableRLS();

// Append-only: o papel da aplicação só tem INSERT (ver migração de grants).
// Sem RLS de leitura para o usuário; leitura apenas por papéis administrativos.
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorType: text("actor_type", { enum: ["user", "admin", "system", "ai"] }).notNull(),
    actorId: uuid("actor_id"),
    subjectUserId: uuid("subject_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").notNull().default({}),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_subject_created_idx").on(t.subjectUserId, t.createdAt),
    index("audit_logs_action_created_idx").on(t.action, t.createdAt),
    check("audit_logs_actor_type_check", sql`${t.actorType} in ('user','admin','system','ai')`),
  ],
);
