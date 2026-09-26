import { FREE_MAX_ACTIVE_GOALS } from "@norbius/domain";
import { z } from "zod";
import { accountTypeSchema, amountCentsSchema, isoDateSchema, signedCentsSchema } from "./finance";
import { nameSchema } from "./auth";

export const ONBOARDING_STEPS = ["name", "income", "frequency", "accounts", "cards", "fixed", "goals", "balances"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Chaves das categorias do sistema aceitas em despesas fixas do onboarding. */
export const FIXED_EXPENSE_CATEGORY_KEYS = [
  "moradia",
  "contas",
  "assinaturas",
  "transporte",
  "saude",
  "educacao",
  "alimentacao",
  "lazer",
  "outros",
] as const;

export const onboardingCompleteSchema = z.object({
  displayName: nameSchema,
  income: z
    .object({
      avgMonthlyCents: amountCentsSchema.nullable(),
      frequency: z.enum(["monthly", "biweekly", "weekly", "irregular"]).nullable(),
      days: z.array(z.number().int().min(1).max(31)).max(2).default([]),
      /** Cria receita recorrente (estimada) a partir da renda informada. */
      createRecurring: z.boolean().default(false),
    })
    .nullable()
    .default(null),
  accounts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        type: accountTypeSchema,
        initialBalanceCents: signedCentsSchema.nullable().default(null),
      }),
    )
    .max(10)
    .default([]),
  cards: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        limitCents: z.number().int().min(0).max(100_000_000_000),
        closingDay: z.number().int().min(1).max(31),
        dueDay: z.number().int().min(1).max(31),
      }),
    )
    .max(10)
    .default([]),
  fixedExpenses: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(140),
        amountCents: amountCentsSchema,
        dayOfMonth: z.number().int().min(1).max(31),
        categoryKey: z.enum(FIXED_EXPENSE_CATEGORY_KEYS),
      }),
    )
    .max(30)
    .default([]),
  goals: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        targetAmountCents: amountCentsSchema,
        targetDate: isoDateSchema.nullable().default(null),
      }),
    )
    // Contas novas começam no plano grátis (limite de metas ativas).
    .max(FREE_MAX_ACTIVE_GOALS)
    .default([]),
});
export type OnboardingCompleteInput = z.input<typeof onboardingCompleteSchema>;

export const onboardingDraftSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  data: z.record(z.string(), z.unknown()),
});

export type OnboardingState = {
  status: "not_started" | "in_progress" | "completed" | "skipped";
  step: OnboardingStep | null;
  draft: Record<string, unknown> | null;
};

/** Resumo inicial: só com o que o usuário informou; estimativas marcadas. */
export type OnboardingSummary = {
  accountsCount: number;
  informedBalanceCents: number | null;
  cardsCount: number;
  fixedExpensesMonthlyCents: number;
  incomeMonthlyCents: number | null;
  /** Renda − despesas fixas. Estimativa; null se a renda não foi informada. */
  estimatedMonthlyLeftoverCents: number | null;
  goalsCount: number;
  missing: ("income" | "accounts" | "balances" | "fixed")[];
};
