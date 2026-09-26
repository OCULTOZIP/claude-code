import type { OnboardingCompleteInput } from "@norbius/contracts";

export type AccountDraft = { name: string; type: "checking" | "savings" | "wallet" | "investment" | "other" };
export type CardDraft = { name: string; limitCents: number; closingDay: number; dueDay: number };
export type FixedDraft = { description: string; amountCents: number; dayOfMonth: number; categoryKey: string };
export type GoalDraft = { name: string; targetAmountCents: number; targetDate: string | null };

export type Draft = {
  step: number;
  name: string;
  incomeCents: number | null;
  frequency: "monthly" | "biweekly" | "weekly" | "irregular" | null;
  days: number[];
  createRecurring: boolean;
  accounts: AccountDraft[];
  cards: CardDraft[];
  fixed: FixedDraft[];
  goals: GoalDraft[];
  balances: (number | null)[];
};

export const STEP_KEYS = ["name", "income", "frequency", "accounts", "cards", "fixed", "goals", "balances"] as const;

export function emptyDraft(name: string): Draft {
  return {
    step: 0,
    name,
    incomeCents: null,
    frequency: null,
    days: [],
    createRecurring: true,
    accounts: [],
    cards: [],
    fixed: [],
    goals: [],
    balances: [],
  };
}

export function toCompleteInput(d: Draft): OnboardingCompleteInput {
  return {
    displayName: d.name,
    income:
      d.incomeCents || d.frequency
        ? {
            avgMonthlyCents: d.incomeCents,
            frequency: d.frequency,
            days: d.days,
            createRecurring: d.createRecurring && Boolean(d.incomeCents) && d.days.length > 0,
          }
        : null,
    accounts: d.accounts.map((a, i) => ({ ...a, initialBalanceCents: d.balances[i] ?? null })),
    cards: d.cards,
    fixedExpenses: d.fixed as OnboardingCompleteInput["fixedExpenses"],
    goals: d.goals,
  };
}

export const ACCOUNT_TYPES: { value: AccountDraft["type"]; label: string }[] = [
  { value: "checking", label: "Conta corrente" },
  { value: "savings", label: "Poupança" },
  { value: "wallet", label: "Carteira" },
  { value: "investment", label: "Investimentos" },
  { value: "other", label: "Outra" },
];

export const FIXED_SUGGESTIONS: { description: string; categoryKey: string }[] = [
  { description: "Aluguel", categoryKey: "moradia" },
  { description: "Condomínio", categoryKey: "moradia" },
  { description: "Luz", categoryKey: "contas" },
  { description: "Água", categoryKey: "contas" },
  { description: "Internet", categoryKey: "contas" },
  { description: "Celular", categoryKey: "contas" },
  { description: "Streaming", categoryKey: "assinaturas" },
  { description: "Academia", categoryKey: "saude" },
  { description: "Plano de saúde", categoryKey: "saude" },
  { description: "Escola / curso", categoryKey: "educacao" },
  { description: "Transporte", categoryKey: "transporte" },
];

export const FIXED_CATEGORY_LABELS: Record<string, string> = {
  moradia: "Moradia",
  contas: "Contas",
  assinaturas: "Assinaturas",
  transporte: "Transporte",
  saude: "Saúde",
  educacao: "Educação",
  alimentacao: "Alimentação",
  lazer: "Lazer",
  outros: "Outros",
};
