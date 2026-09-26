import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgPolicy, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Notificações (Fase 4, parte 2 — ADR 0005). Derivam dos insights; e-mails
// respeitam preferências e horário silencioso (22h–8h no fuso do usuário).
const ownRows = sql`user_id = nullif(current_setting('app.user_id', true), '')::uuid`;
const owner = (table: string) =>
  pgPolicy(`${table}_owner`, { for: "all", to: "norbius_app", using: ownRows, withCheck: ownRows });
const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

export const NOTIFICATION_TYPES = ["bill_due", "goal_reached", "unusual_spending", "card_limit", "financial_summary", "insight"] as const;
export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;
export const NOTIFICATION_STATUSES = ["pending", "sent", "read", "failed", "skipped"] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Links e referências (insightId, severidade). */
    data: jsonb("data").notNull().default({}),
    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    status: text("status", { enum: NOTIFICATION_STATUSES }).notNull().default("pending"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    /** insight.fingerprint + canal: um aviso por insight e canal. */
    dedupKey: text("dedup_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("notifications_user_dedup_unique").on(t.userId, t.dedupKey),
    index("notifications_user_channel_created_idx").on(t.userId, t.channel, t.createdAt.desc()),
    index("notifications_due_idx").on(t.status, t.scheduledFor),
    check("notifications_type_check", sql`${t.type} in ('bill_due','goal_reached','unusual_spending','card_limit','financial_summary','insight')`),
    check("notifications_channel_check", sql`${t.channel} in ('in_app','email','push')`),
    check("notifications_status_check", sql`${t.status} in ('pending','sent','read','failed','skipped')`),
    check("notifications_text_check", sql`char_length(${t.title}) between 1 and 200 and char_length(${t.body}) between 1 and 1000`),
    owner("notifications"),
  ],
).enableRLS();

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: userId(),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    inApp: boolean("in_app").notNull(),
    email: boolean("email").notNull(),
    push: boolean("push").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ name: "notification_preferences_pk", columns: [t.userId, t.type] }),
    check(
      "notification_preferences_type_check",
      sql`${t.type} in ('bill_due','goal_reached','unusual_spending','card_limit','financial_summary','insight')`,
    ),
    owner("notification_preferences"),
  ],
).enableRLS();

/** Controle da análise diária (06:00 no fuso do usuário). */
export const intelligenceRuns = pgTable(
  "intelligence_runs",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    lastDailyRunOn: date("last_daily_run_on", { mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [owner("intelligence_runs")],
).enableRLS();
