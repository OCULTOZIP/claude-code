import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// Núcleo financeiro. Regras gerais:
// - valores em centavos (bigint), sempre positivos; o tipo define o sinal;
// - toda tabela tem user_id + RLS; referências entre tabelas do usuário usam
//   FK composta (user_id, id), impedindo apontar para dados de outro usuário
//   mesmo que a aplicação erre;
// - exclusões de movimentações são lógicas (deleted_at) para permitir desfazer.

const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const ownRows = sql`user_id = ${currentUser}`;
const owner = (table: string) =>
  pgPolicy(`${table}_owner`, { for: "all", to: "norbius_app", using: ownRows, withCheck: ownRows });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

const cents = (name: string) => bigint(name, { mode: "number" });
const inList = (col: SQL | unknown, values: string[]) =>
  sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(","))})`;

export const ACCOUNT_TYPES = ["checking", "savings", "wallet", "investment", "other"] as const;
export const TRANSACTION_TYPES = ["income", "expense", "transfer"] as const;
export const PAYMENT_METHODS = ["pix", "debit", "cash", "boleto", "transfer", "credit_card_invoice", "other"] as const;
export const SOURCES = ["manual", "ai", "onboarding", "import", "open_finance", "system"] as const;
export const FREQUENCIES = ["weekly", "biweekly", "monthly", "yearly"] as const;

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    institutionName: text("institution_name"),
    initialBalanceCents: cents("initial_balance_cents").notNull().default(0),
    initialBalanceDate: date("initial_balance_date").notNull(),
    currency: text("currency").notNull().default("BRL"),
    includeInAvailableBalance: boolean("include_in_available_balance").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    // Compatibilidade futura com Open Finance (FK criada quando a integração existir).
    externalAccountId: uuid("external_account_id"),
    ...timestamps,
  },
  (t) => [
    unique("accounts_user_id_id_unique").on(t.userId, t.id),
    index("accounts_user_idx").on(t.userId),
    check("accounts_type_check", inList(t.type, [...ACCOUNT_TYPES])),
    check("accounts_name_check", sql`char_length(${t.name}) between 1 and 60`),
    check("accounts_currency_check", sql`${t.currency} = 'BRL'`),
    check("accounts_initial_balance_check", sql`abs(${t.initialBalanceCents}) <= 100000000000`),
    check("accounts_source_check", inList(t.source, [...SOURCES])),
    owner("accounts"),
  ],
).enableRLS();

// Categorias do sistema têm user_id nulo e são visíveis a todos (somente leitura).
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["income", "expense"] }).notNull(),
    systemKey: text("system_key"),
    icon: text("icon"),
    color: text("color"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("categories_system_key_unique").on(t.systemKey, t.kind).where(sql`${t.userId} is null`),
    uniqueIndex("categories_user_name_unique")
      .on(t.userId, sql`lower(${t.name})`, t.kind)
      .where(sql`${t.userId} is not null`),
    check("categories_kind_check", sql`${t.kind} in ('income','expense')`),
    check("categories_name_check", sql`char_length(${t.name}) between 1 and 40`),
    check("categories_system_check", sql`(${t.userId} is null) = (${t.systemKey} is not null)`),
    pgPolicy("categories_read", {
      for: "select",
      to: "norbius_app",
      using: sql`user_id is null or user_id = ${currentUser}`,
    }),
    pgPolicy("categories_insert", { for: "insert", to: "norbius_app", withCheck: ownRows }),
    pgPolicy("categories_update", { for: "update", to: "norbius_app", using: ownRows, withCheck: ownRows }),
    pgPolicy("categories_delete", { for: "delete", to: "norbius_app", using: ownRows }),
  ],
).enableRLS();

export const creditCards = pgTable(
  "credit_cards",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    name: text("name").notNull(),
    brand: text("brand"),
    lastFour: text("last_four"),
    limitCents: cents("limit_cents").notNull(),
    closingDay: smallint("closing_day").notNull(),
    dueDay: smallint("due_day").notNull(),
    defaultPaymentAccountId: uuid("default_payment_account_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    externalAccountId: uuid("external_account_id"),
    ...timestamps,
  },
  (t) => [
    unique("credit_cards_user_id_id_unique").on(t.userId, t.id),
    index("credit_cards_user_idx").on(t.userId),
    foreignKey({
      name: "credit_cards_payment_account_fk",
      columns: [t.userId, t.defaultPaymentAccountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    check("credit_cards_name_check", sql`char_length(${t.name}) between 1 and 60`),
    check("credit_cards_limit_check", sql`${t.limitCents} between 0 and 100000000000`),
    check("credit_cards_closing_day_check", sql`${t.closingDay} between 1 and 31`),
    check("credit_cards_due_day_check", sql`${t.dueDay} between 1 and 31`),
    check("credit_cards_last_four_check", sql`${t.lastFour} is null or ${t.lastFour} ~ '^[0-9]{4}$'`),
    check("credit_cards_source_check", inList(t.source, [...SOURCES])),
    owner("credit_cards"),
  ],
).enableRLS();

export const creditCardInvoices = pgTable(
  "credit_card_invoices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    creditCardId: uuid("credit_card_id").notNull(),
    // 1º dia do mês de referência. Status é derivado (ver @norbius/domain invoiceStatus).
    referenceMonth: date("reference_month").notNull(),
    closingDate: date("closing_date").notNull(),
    dueDate: date("due_date").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("credit_card_invoices_user_id_id_unique").on(t.userId, t.id),
    unique("credit_card_invoices_card_month_unique").on(t.creditCardId, t.referenceMonth),
    foreignKey({
      name: "credit_card_invoices_card_fk",
      columns: [t.userId, t.creditCardId],
      foreignColumns: [creditCards.userId, creditCards.id],
    }).onDelete("cascade"),
    check("credit_card_invoices_month_check", sql`extract(day from ${t.referenceMonth}) = 1`),
    check("credit_card_invoices_dates_check", sql`${t.dueDate} >= ${t.closingDate}`),
    owner("credit_card_invoices"),
  ],
).enableRLS();

export const recurringTransactions = pgTable(
  "recurring_transactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    accountId: uuid("account_id"),
    creditCardId: uuid("credit_card_id"),
    type: text("type", { enum: ["income", "expense"] }).notNull(),
    amountCents: cents("amount_cents").notNull(),
    amountIsEstimate: boolean("amount_is_estimate").notNull().default(false),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    description: text("description").notNull(),
    frequency: text("frequency", { enum: FREQUENCIES }).notNull(),
    dayOfMonth: smallint("day_of_month"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    // Última ocorrência já registrada ou pulada; a próxima pendente é calculada.
    lastHandledDate: date("last_handled_date"),
    active: boolean("active").notNull().default(true),
    detectedBy: text("detected_by", { enum: ["user", "intelligence"] }).notNull().default("user"),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    ...timestamps,
  },
  (t) => [
    unique("recurring_transactions_user_id_id_unique").on(t.userId, t.id),
    index("recurring_transactions_user_idx").on(t.userId).where(sql`${t.active}`),
    foreignKey({
      name: "recurring_transactions_account_fk",
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    foreignKey({
      name: "recurring_transactions_card_fk",
      columns: [t.userId, t.creditCardId],
      foreignColumns: [creditCards.userId, creditCards.id],
    }),
    check("recurring_transactions_type_check", sql`${t.type} in ('income','expense')`),
    check("recurring_transactions_amount_check", sql`${t.amountCents} between 1 and 100000000000`),
    check("recurring_transactions_target_check", sql`num_nonnulls(${t.accountId}, ${t.creditCardId}) = 1`),
    check("recurring_transactions_card_expense_check", sql`${t.creditCardId} is null or ${t.type} = 'expense'`),
    check("recurring_transactions_frequency_check", inList(t.frequency, [...FREQUENCIES])),
    check("recurring_transactions_day_check", sql`${t.dayOfMonth} is null or ${t.dayOfMonth} between 1 and 31`),
    check("recurring_transactions_end_check", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check("recurring_transactions_description_check", sql`char_length(${t.description}) between 1 and 140`),
    check("recurring_transactions_detected_by_check", sql`${t.detectedBy} in ('user','intelligence')`),
    check("recurring_transactions_source_check", inList(t.source, [...SOURCES])),
    owner("recurring_transactions"),
  ],
).enableRLS();

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    accountId: uuid("account_id").notNull(),
    type: text("type", { enum: TRANSACTION_TYPES }).notNull(),
    amountCents: cents("amount_cents").notNull(),
    currency: text("currency").notNull().default("BRL"),
    categoryId: uuid("category_id").references(() => categories.id),
    description: text("description").notNull(),
    date: date("date").notNull(),
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS }),
    recurring: boolean("recurring").notNull().default(false),
    recurringTransactionId: uuid("recurring_transaction_id"),
    transferAccountId: uuid("transfer_account_id"),
    creditCardInvoiceId: uuid("credit_card_invoice_id"),
    notes: text("notes"),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    externalProvider: text("external_provider"),
    externalId: text("external_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "transactions_account_fk",
      columns: [t.userId, t.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    foreignKey({
      name: "transactions_transfer_account_fk",
      columns: [t.userId, t.transferAccountId],
      foreignColumns: [accounts.userId, accounts.id],
    }),
    foreignKey({
      name: "transactions_invoice_fk",
      columns: [t.userId, t.creditCardInvoiceId],
      foreignColumns: [creditCardInvoices.userId, creditCardInvoices.id],
    }),
    foreignKey({
      name: "transactions_recurring_fk",
      columns: [t.userId, t.recurringTransactionId],
      foreignColumns: [recurringTransactions.userId, recurringTransactions.id],
    }).onDelete("set null"),
    index("transactions_user_date_idx").on(t.userId, t.date.desc()).where(sql`${t.deletedAt} is null`),
    index("transactions_user_account_idx").on(t.userId, t.accountId),
    index("transactions_transfer_account_idx").on(t.userId, t.transferAccountId).where(sql`${t.transferAccountId} is not null`),
    index("transactions_invoice_idx").on(t.creditCardInvoiceId).where(sql`${t.creditCardInvoiceId} is not null`),
    index("transactions_user_category_idx").on(t.userId, t.categoryId, t.date),
    index("transactions_description_trgm_idx").using("gin", sql`${t.description} gin_trgm_ops`),
    uniqueIndex("transactions_external_unique")
      .on(t.userId, t.externalProvider, t.externalId)
      .where(sql`${t.externalId} is not null`),
    check("transactions_type_check", inList(t.type, [...TRANSACTION_TYPES])),
    check("transactions_amount_check", sql`${t.amountCents} between 1 and 100000000000`),
    check("transactions_currency_check", sql`${t.currency} = 'BRL'`),
    check("transactions_description_check", sql`char_length(${t.description}) between 1 and 140`),
    check("transactions_notes_check", sql`${t.notes} is null or char_length(${t.notes}) <= 1000`),
    check("transactions_category_check", sql`(${t.type} = 'transfer') = (${t.categoryId} is null)`),
    check(
      "transactions_transfer_target_check",
      sql`case when ${t.type} = 'transfer'
        then num_nonnulls(${t.transferAccountId}, ${t.creditCardInvoiceId}) = 1
        else ${t.transferAccountId} is null and ${t.creditCardInvoiceId} is null end`,
    ),
    check("transactions_self_transfer_check", sql`${t.transferAccountId} is null or ${t.transferAccountId} <> ${t.accountId}`),
    check("transactions_payment_method_check", sql`${t.paymentMethod} is null or ${inList(t.paymentMethod, [...PAYMENT_METHODS])}`),
    check("transactions_source_check", inList(t.source, [...SOURCES])),
    owner("transactions"),
  ],
).enableRLS();

export const creditCardPurchases = pgTable(
  "credit_card_purchases",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    creditCardId: uuid("credit_card_id").notNull(),
    description: text("description").notNull(),
    totalAmountCents: cents("total_amount_cents").notNull(),
    installmentCount: smallint("installment_count").notNull().default(1),
    purchaseDate: date("purchase_date").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    recurringTransactionId: uuid("recurring_transaction_id"),
    notes: text("notes"),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    externalProvider: text("external_provider"),
    externalId: text("external_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("credit_card_purchases_user_id_id_unique").on(t.userId, t.id),
    index("credit_card_purchases_user_date_idx").on(t.userId, t.purchaseDate.desc()).where(sql`${t.deletedAt} is null`),
    foreignKey({
      name: "credit_card_purchases_card_fk",
      columns: [t.userId, t.creditCardId],
      foreignColumns: [creditCards.userId, creditCards.id],
    }),
    foreignKey({
      name: "credit_card_purchases_recurring_fk",
      columns: [t.userId, t.recurringTransactionId],
      foreignColumns: [recurringTransactions.userId, recurringTransactions.id],
    }).onDelete("set null"),
    uniqueIndex("credit_card_purchases_external_unique")
      .on(t.userId, t.externalProvider, t.externalId)
      .where(sql`${t.externalId} is not null`),
    check("credit_card_purchases_amount_check", sql`${t.totalAmountCents} between 1 and 100000000000`),
    check("credit_card_purchases_installments_check", sql`${t.installmentCount} between 1 and 48`),
    check("credit_card_purchases_installments_amount_check", sql`${t.installmentCount} <= ${t.totalAmountCents}`),
    check("credit_card_purchases_description_check", sql`char_length(${t.description}) between 1 and 140`),
    check("credit_card_purchases_notes_check", sql`${t.notes} is null or char_length(${t.notes}) <= 1000`),
    check("credit_card_purchases_source_check", inList(t.source, [...SOURCES])),
    owner("credit_card_purchases"),
  ],
).enableRLS();

export const creditCardTransactions = pgTable(
  "credit_card_transactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    purchaseId: uuid("purchase_id").notNull(),
    creditCardId: uuid("credit_card_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    installmentNumber: smallint("installment_number").notNull(),
    amountCents: cents("amount_cents").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    competenceDate: date("competence_date").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("credit_card_transactions_installment_unique").on(t.purchaseId, t.installmentNumber),
    index("credit_card_transactions_invoice_idx").on(t.userId, t.invoiceId),
    index("credit_card_transactions_competence_idx").on(t.userId, t.competenceDate),
    foreignKey({
      name: "credit_card_transactions_purchase_fk",
      columns: [t.userId, t.purchaseId],
      foreignColumns: [creditCardPurchases.userId, creditCardPurchases.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "credit_card_transactions_card_fk",
      columns: [t.userId, t.creditCardId],
      foreignColumns: [creditCards.userId, creditCards.id],
    }),
    foreignKey({
      name: "credit_card_transactions_invoice_fk",
      columns: [t.userId, t.invoiceId],
      foreignColumns: [creditCardInvoices.userId, creditCardInvoices.id],
    }),
    check("credit_card_transactions_amount_check", sql`${t.amountCents} > 0`),
    check("credit_card_transactions_installment_check", sql`${t.installmentNumber} between 1 and 48`),
    owner("credit_card_transactions"),
  ],
).enableRLS();

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    name: text("name").notNull(),
    targetAmountCents: cents("target_amount_cents").notNull(),
    targetDate: date("target_date"),
    status: text("status", { enum: ["active", "completed", "archived"] }).notNull().default("active"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    ...timestamps,
  },
  (t) => [
    unique("goals_user_id_id_unique").on(t.userId, t.id),
    index("goals_user_idx").on(t.userId),
    check("goals_name_check", sql`char_length(${t.name}) between 1 and 60`),
    check("goals_target_check", sql`${t.targetAmountCents} between 1 and 100000000000`),
    check("goals_status_check", sql`${t.status} in ('active','completed','archived')`),
    check("goals_source_check", inList(t.source, [...SOURCES])),
    owner("goals"),
  ],
).enableRLS();

// Valor atual da meta = soma dos aportes (derivado, nunca armazenado).
export const goalContributions = pgTable(
  "goal_contributions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    goalId: uuid("goal_id").notNull(),
    amountCents: cents("amount_cents").notNull(), // negativo = retirada
    date: date("date").notNull(),
    note: text("note"),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("goal_contributions_goal_idx").on(t.userId, t.goalId, t.date),
    foreignKey({
      name: "goal_contributions_goal_fk",
      columns: [t.userId, t.goalId],
      foreignColumns: [goals.userId, goals.id],
    }).onDelete("cascade"),
    check("goal_contributions_amount_check", sql`${t.amountCents} <> 0 and abs(${t.amountCents}) <= 100000000000`),
    check("goal_contributions_note_check", sql`${t.note} is null or char_length(${t.note}) <= 200`),
    check("goal_contributions_source_check", inList(t.source, [...SOURCES])),
    owner("goal_contributions"),
  ],
).enableRLS();
