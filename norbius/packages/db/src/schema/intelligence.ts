import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Inteligência financeira (Fase 4, ADR 0005). Insights vêm de detectores
// determinísticos; `evidence` guarda os números que os sustentam.
const ownRows = sql`user_id = nullif(current_setting('app.user_id', true), '')::uuid`;
const owner = (table: string) =>
  pgPolicy(`${table}_owner`, { for: "all", to: "norbius_app", using: ownRows, withCheck: ownRows });
const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

export const INSIGHT_SEVERITIES = ["info", "opportunity", "attention", "critical"] as const;
export const INSIGHT_STATUSES = ["open", "seen", "dismissed", "resolved", "expired"] as const;
export const CORE_STATES = ["ACTIVE", "ANALYZING", "STABLE", "ATTENTION", "OPTIMIZING"] as const;

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    type: text("type").notNull(),
    severity: text("severity", { enum: INSIGHT_SEVERITIES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    evidence: jsonb("evidence").notNull(),
    fingerprint: text("fingerprint").notNull(),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    status: text("status", { enum: INSIGHT_STATUSES }).notNull().default("open"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("insights_user_fingerprint_unique").on(t.userId, t.fingerprint),
    index("insights_user_status_idx").on(t.userId, t.status),
    check("insights_severity_check", sql`${t.severity} in ('info','opportunity','attention','critical')`),
    check("insights_status_check", sql`${t.status} in ('open','seen','dismissed','resolved','expired')`),
    check("insights_text_check", sql`char_length(${t.title}) between 1 and 200 and char_length(${t.body}) between 1 and 1000`),
    owner("insights"),
  ],
).enableRLS();

export const projectionSnapshots = pgTable(
  "projection_snapshots",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    horizonEnd: date("horizon_end", { mode: "string" }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    inputsHash: text("inputs_hash").notNull(),
    methodVersion: text("method_version").notNull(),
    /** Série diária p10/p50/p90 + premissas. */
    result: jsonb("result").notNull(),
    confidence: text("confidence", { enum: ["low", "medium", "high"] }).notNull(),
  },
  (t) => [
    index("projection_snapshots_user_generated_idx").on(t.userId, t.generatedAt.desc()),
    check("projection_snapshots_confidence_check", sql`${t.confidence} in ('low','medium','high')`),
    owner("projection_snapshots"),
  ],
).enableRLS();

export const coreStateEvents = pgTable(
  "core_state_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    state: text("state", { enum: CORE_STATES }).notNull(),
    /** Ex.: [{"insightId": "...", "type": "bill_due"}] */
    reasons: jsonb("reasons").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("core_state_events_user_created_idx").on(t.userId, t.createdAt.desc()),
    check("core_state_events_state_check", sql`${t.state} in ('ACTIVE','ANALYZING','STABLE','ATTENTION','OPTIMIZING')`),
    owner("core_state_events"),
  ],
).enableRLS();
