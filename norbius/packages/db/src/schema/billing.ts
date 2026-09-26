import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Assinaturas (Fase 6, ADR 0004). O acesso Pro é derivado das datas
// (`trial_ends_on`, `paid_through`) em @norbius/domain, nunca guardado.
const ownRows = sql`user_id = nullif(current_setting('app.user_id', true), '')::uuid`;
const owner = (table: string) =>
  pgPolicy(`${table}_owner`, { for: "all", to: "norbius_app", using: ownRows, withCheck: ownRows });

export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["none", "trialing", "pending", "active", "past_due", "canceled"] })
      .notNull()
      .default("none"),
    cycle: text("cycle", { enum: ["monthly", "yearly"] }),
    provider: text("provider", { enum: ["asaas", "fake"] }),
    providerCustomerId: text("provider_customer_id").unique(),
    providerSubscriptionId: text("provider_subscription_id").unique(),
    /** Teste grátis só pode ser iniciado uma vez. */
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    trialEndsOn: date("trial_ends_on", { mode: "string" }),
    paidThrough: date("paid_through", { mode: "string" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("subscriptions_status_check", sql`${t.status} in ('none','trialing','pending','active','past_due','canceled')`),
    check("subscriptions_cycle_check", sql`${t.cycle} is null or ${t.cycle} in ('monthly','yearly')`),
    check("subscriptions_provider_check", sql`${t.provider} is null or ${t.provider} in ('asaas','fake')`),
    owner("subscriptions"),
  ],
).enableRLS();

export const billingPayments = pgTable(
  "billing_payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerPaymentId: text("provider_payment_id").notNull().unique(),
    providerSubscriptionId: text("provider_subscription_id"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: text("status", { enum: ["pending", "paid", "overdue", "refunded", "canceled"] }).notNull(),
    billingType: text("billing_type"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    invoiceUrl: text("invoice_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("billing_payments_user_due_idx").on(t.userId, t.dueDate.desc()),
    check("billing_payments_amount_check", sql`${t.amountCents} >= 0`),
    check("billing_payments_status_check", sql`${t.status} in ('pending','paid','overdue','refunded','canceled')`),
    owner("billing_payments"),
  ],
).enableRLS();

/**
 * Registro idempotente de webhooks do provedor. Não contém dados pessoais:
 * só o id do evento, o tipo e o resultado do processamento.
 */
export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  type: text("type").notNull(),
  outcome: text("outcome"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});
