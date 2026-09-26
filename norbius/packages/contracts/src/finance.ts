import { isIsoDate, MAX_AMOUNT_CENTS } from "@norbius/domain";
import { z } from "zod";

// ── Primitivos ──────────────────────────────────────────────
export const isoDateSchema = z.string().refine(isIsoDate, "Data inválida.");
export const isoMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido.");
export const amountCentsSchema = z
  .number({ error: "Informe o valor." })
  .int("Valor inválido.")
  .min(1, "O valor precisa ser maior que zero.")
  .max(MAX_AMOUNT_CENTS, "Valor acima do permitido.");
export const signedCentsSchema = z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS);
export const uuidSchema = z.uuid("Identificador inválido.");
const text = (label: string, max: number) =>
  z.string().trim().min(1, `Informe ${label}.`).max(max, `Use no máximo ${max} caracteres.`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const ACCOUNT_TYPE_LABELS = {
  checking: "Conta corrente",
  savings: "Poupança",
  wallet: "Carteira",
  investment: "Investimentos",
  other: "Outra",
} as const;
export const accountTypeSchema = z.enum(["checking", "savings", "wallet", "investment", "other"]);
export const transactionTypeSchema = z.enum(["income", "expense", "transfer"]);
export const paymentMethodSchema = z.enum(["pix", "debit", "cash", "boleto", "transfer", "other"]);
export const PAYMENT_METHOD_LABELS = {
  pix: "Pix",
  debit: "Débito",
  cash: "Dinheiro",
  boleto: "Boleto",
  transfer: "Transferência",
  credit_card_invoice: "Fatura do cartão",
  other: "Outro",
} as const;
export const frequencySchema = z.enum(["weekly", "biweekly", "monthly", "yearly"]);
export const FREQUENCY_LABELS = { weekly: "Semanal", biweekly: "Quinzenal", monthly: "Mensal", yearly: "Anual" } as const;

// ── Contas ──────────────────────────────────────────────────
export const accountInputSchema = z.object({
  name: text("o nome", 60),
  type: accountTypeSchema,
  institutionName: optionalText(60),
  initialBalanceCents: signedCentsSchema.default(0),
  initialBalanceDate: isoDateSchema.optional(),
  includeInAvailableBalance: z.boolean().optional(),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export type AccountView = {
  id: string;
  name: string;
  type: z.infer<typeof accountTypeSchema>;
  institutionName: string | null;
  initialBalanceCents: number;
  initialBalanceDate: string;
  includeInAvailableBalance: boolean;
  archived: boolean;
  balanceCents: number;
};

// ── Categorias ──────────────────────────────────────────────
export const categoryInputSchema = z.object({
  name: text("o nome", 40),
  kind: z.enum(["income", "expense"]),
});
export type CategoryView = { id: string; name: string; kind: "income" | "expense"; system: boolean; icon: string | null };

// ── Transações ──────────────────────────────────────────────
const movement = z.object({
  type: z.enum(["income", "expense"]),
  accountId: uuidSchema,
  amountCents: amountCentsSchema,
  categoryId: uuidSchema,
  description: text("a descrição", 140),
  date: isoDateSchema,
  paymentMethod: paymentMethodSchema.optional().nullable(),
  notes: optionalText(1000),
});
const transfer = z.object({
  type: z.literal("transfer"),
  accountId: uuidSchema,
  transferAccountId: uuidSchema,
  amountCents: amountCentsSchema,
  description: z.string().trim().max(140).optional(),
  date: isoDateSchema,
  notes: optionalText(1000),
});
export const transactionInputSchema = z.discriminatedUnion("type", [movement, transfer]).superRefine((v, ctx) => {
  if (v.type === "transfer" && v.accountId === v.transferAccountId) {
    ctx.addIssue({ code: "custom", path: ["transferAccountId"], message: "Escolha uma conta de destino diferente." });
  }
});
export type TransactionInput = z.input<typeof transactionInputSchema>;

export const transactionSortSchema = z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]);
export const transactionListQuerySchema = z.object({
  month: isoMonthSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  type: transactionTypeSchema.optional(),
  accountId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  q: z.string().trim().max(80).optional(),
  sort: transactionSortSchema.default("date_desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type TransactionListQuery = z.input<typeof transactionListQuerySchema>;

export type TransactionView = {
  id: string;
  type: "income" | "expense" | "transfer";
  amountCents: number;
  description: string;
  date: string;
  account: { id: string; name: string };
  transferAccount: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  creditCardInvoiceId: string | null;
  paymentMethod: string | null;
  notes: string | null;
  source: string;
  recurringTransactionId: string | null;
};
export type TransactionList = {
  items: TransactionView[];
  total: number;
  page: number;
  pageSize: number;
  totals: { incomeCents: number; expenseCents: number };
};

// ── Recorrências (contas fixas e receitas recorrentes) ──────
export const recurringInputSchema = z
  .object({
    type: z.enum(["income", "expense"]),
    accountId: uuidSchema.optional().nullable(),
    creditCardId: uuidSchema.optional().nullable(),
    amountCents: amountCentsSchema,
    amountIsEstimate: z.boolean().default(false),
    categoryId: uuidSchema,
    description: text("a descrição", 140),
    frequency: frequencySchema,
    dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.accountId) === Boolean(v.creditCardId)) {
      ctx.addIssue({ code: "custom", path: ["accountId"], message: "Escolha uma conta ou um cartão." });
    }
    if (v.creditCardId && v.type === "income") {
      ctx.addIssue({ code: "custom", path: ["creditCardId"], message: "Receitas não podem ser lançadas no cartão." });
    }
    if (v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "A data final deve ser após o início." });
    }
  });
export type RecurringInput = z.input<typeof recurringInputSchema>;
export const recurringConfirmSchema = z.object({
  date: isoDateSchema,
  amountCents: amountCentsSchema.optional(),
});

export type RecurringView = {
  id: string;
  type: "income" | "expense";
  description: string;
  amountCents: number;
  amountIsEstimate: boolean;
  frequency: z.infer<typeof frequencySchema>;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
  account: { id: string; name: string } | null;
  creditCard: { id: string; name: string } | null;
  category: { id: string; name: string };
  /** Próxima ocorrência ainda não registrada (calculada), ou null se terminou. */
  nextDate: string | null;
  monthlyEquivalentCents: number;
};

// ── Cartões ─────────────────────────────────────────────────
export const creditCardInputSchema = z.object({
  name: text("o nome", 60),
  brand: optionalText(30),
  lastFour: z
    .string()
    .regex(/^\d{4}$/, "Informe os 4 últimos dígitos.")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  limitCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS),
  closingDay: z.number().int().min(1, "Dia inválido.").max(31, "Dia inválido."),
  dueDay: z.number().int().min(1, "Dia inválido.").max(31, "Dia inválido."),
  defaultPaymentAccountId: uuidSchema.optional().nullable(),
});
export type CreditCardInput = z.input<typeof creditCardInputSchema>;

export const purchaseInputSchema = z
  .object({
    creditCardId: uuidSchema,
    description: text("a descrição", 140),
    totalAmountCents: amountCentsSchema,
    installmentCount: z.number().int().min(1).max(48).default(1),
    purchaseDate: isoDateSchema,
    categoryId: uuidSchema,
    notes: optionalText(1000),
  })
  .refine((v) => v.installmentCount <= v.totalAmountCents, {
    path: ["installmentCount"],
    message: "Parcelas demais para esse valor.",
  });
export type PurchaseInput = z.input<typeof purchaseInputSchema>;

export const invoicePaymentSchema = z.object({
  accountId: uuidSchema,
  amountCents: amountCentsSchema,
  date: isoDateSchema,
});

export type InvoiceStatusView = "open" | "closed" | "paid" | "partially_paid" | "overdue";
export type InvoiceView = {
  id: string;
  creditCardId: string;
  referenceMonth: string;
  closingDate: string;
  dueDate: string;
  totalCents: number;
  paidCents: number;
  status: InvoiceStatusView;
};
export type CreditCardView = {
  id: string;
  name: string;
  brand: string | null;
  lastFour: string | null;
  limitCents: number;
  usedLimitCents: number;
  availableLimitCents: number;
  closingDay: number;
  dueDay: number;
  defaultPaymentAccountId: string | null;
  archived: boolean;
  currentInvoice: InvoiceView | null;
};
export type InvoiceItemView = {
  id: string;
  purchaseId: string;
  description: string;
  category: { id: string; name: string };
  amountCents: number;
  installmentNumber: number;
  installmentCount: number;
  purchaseDate: string;
};

// ── Metas ───────────────────────────────────────────────────
export const goalInputSchema = z.object({
  name: text("o nome", 60),
  targetAmountCents: amountCentsSchema,
  targetDate: isoDateSchema.optional().nullable(),
});
export type GoalInput = z.input<typeof goalInputSchema>;
export const contributionInputSchema = z.object({
  amountCents: signedCentsSchema.refine((v) => v !== 0, "O valor não pode ser zero."),
  date: isoDateSchema,
  note: optionalText(200),
});
export type GoalView = {
  id: string;
  name: string;
  targetAmountCents: number;
  currentAmountCents: number;
  progress: number; // 0..1
  targetDate: string | null;
  status: "active" | "completed" | "archived";
  /** Aporte mensal necessário para cumprir o prazo (null sem prazo ou se já atingida). */
  monthlyNeededCents: number | null;
};
export type ContributionView = { id: string; amountCents: number; date: string; note: string | null };
