import type { CoreState } from "./core";
import type { IntelligenceSummary } from "./intelligence";

export type Figure = { cents: number; kind: "actual" | "estimate" };

export type Commitment = {
  kind: "recurring" | "invoice" | "scheduled";
  id: string;
  description: string;
  date: string;
  amountCents: number;
  direction: "in" | "out";
  isEstimate: boolean;
  overdue: boolean;
};

export type DashboardSummary = {
  month: string;
  today: string;
  hasData: boolean;
  availableBalance: Figure;
  monthIncome: Figure;
  monthExpense: Figure;
  investments: Figure;
  accounts: { id: string; name: string; type: string; balanceCents: number }[];
  topCategories: { categoryId: string; name: string; cents: number; share: number }[];
  commitments: Commitment[];
  recent: {
    id: string;
    kind: "transaction" | "card_purchase";
    type: "income" | "expense" | "transfer";
    description: string;
    date: string;
    amountCents: number;
    label: string;
  }[];
  goals: { id: string; name: string; progress: number; currentAmountCents: number; targetAmountCents: number }[];
  cards: { id: string; name: string; usedLimitCents: number; limitCents: number }[];
  /** Fluxo diário do mês: receitas e despesas por dia (reais). */
  dailyFlow: { date: string; incomeCents: number; expenseCents: number }[];
  core: { state: CoreState; reason: string; historyDays: number };
  /** Inteligência (Fase 4): alertas, projeção e "quanto posso gastar?". */
  intelligence: IntelligenceSummary;
};
