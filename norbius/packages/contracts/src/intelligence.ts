import type { CoreState } from "./core";

export type InsightSeverity = "info" | "opportunity" | "attention" | "critical";

export type InsightView = {
  id: string;
  type: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  status: "open" | "seen";
  createdAt: string;
};

/** Projeção de saldo: sempre estimativa (ADR 0005). */
export type ProjectionView = {
  kind: "estimate";
  confidence: "low" | "medium" | "high";
  horizonEnd: string;
  days: { date: string; p10: number; p50: number; p90: number }[];
  lowest: { date: string; cents: number } | null;
  endCents: number;
  dailyVariableCents: number;
  assumptions: string[];
};

export type SafeToSpendView = {
  kind: "estimate";
  until: string;
  basis: "next_income" | "month_end";
  days: number;
  availableCents: number;
  perDayCents: number;
  perWeekCents: number;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
};

export type IntelligenceSummary = {
  today: string;
  historyDays: number;
  minHistoryDays: number;
  core: { state: CoreState; reason: string; reasons: { insightId: string; type: string }[] };
  insights: InsightView[];
  projection: ProjectionView | null;
  /** Por que a projeção não está disponível (histórico curto, sem contas). */
  projectionUnavailable: string | null;
  safeToSpend: SafeToSpendView | null;
};
