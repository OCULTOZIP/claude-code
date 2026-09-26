import { formatBRL } from "@norbius/domain";
import type { InsightType, Severity } from "./detectors";
import { MIN_HISTORY_DAYS, type Projection } from "./projection";

export type CoreState = "ACTIVE" | "ANALYZING" | "STABLE" | "ATTENTION" | "OPTIMIZING";

export type CoreInsight = { id: string; type: InsightType; severity: Severity; title: string };

export type CoreStateResult = {
  state: CoreState;
  reason: string;
  /** Insights que originaram o estado (clicáveis na UI). */
  reasons: { insightId: string; type: InsightType }[];
};

const RANK: Record<Severity, number> = { critical: 0, attention: 1, opportunity: 2, info: 3 };

/**
 * Estado real do NORBIUS CORE (BLUEPRINT §8.3), por prioridade. ANALYZING só
 * enquanto há processamento de verdade em curso — quem chama informa.
 */
export function coreState(args: {
  analyzing?: boolean;
  hasAccounts: boolean;
  historyDays: number;
  insights: CoreInsight[];
  projection: Projection | null;
}): CoreStateResult {
  const { insights, historyDays } = args;
  if (args.analyzing) return { state: "ANALYZING", reason: "Analisando suas finanças…", reasons: [] };

  const sorted = [...insights].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const alerts = sorted.filter((i) => i.severity === "critical" || i.severity === "attention");
  if (alerts.length) {
    const more = alerts.length > 1 ? ` (+${alerts.length - 1} ${alerts.length === 2 ? "alerta" : "alertas"})` : "";
    return { state: "ATTENTION", reason: `${alerts[0]!.title}${more}.`, reasons: alerts.map((i) => ({ insightId: i.id, type: i.type })) };
  }
  const opportunities = sorted.filter((i) => i.severity === "opportunity");
  if (opportunities.length) {
    return {
      state: "OPTIMIZING",
      reason: `Sem alertas. ${opportunities[0]!.title}.`,
      reasons: opportunities.map((i) => ({ insightId: i.id, type: i.type })),
    };
  }
  if (!args.hasAccounts) return { state: "ACTIVE", reason: "Sistema ativo. Cadastre suas contas para começar.", reasons: [] };
  if (historyDays === 0) return { state: "ACTIVE", reason: "Sistema ativo. Ainda não há movimentações para analisar.", reasons: [] };
  const p = args.projection;
  if (historyDays < MIN_HISTORY_DAYS || !p) {
    const left = MIN_HISTORY_DAYS - historyDays;
    return {
      state: "ACTIVE",
      reason: `Sistema ativo. ${historyDays} ${historyDays === 1 ? "dia" : "dias"} de histórico — a projeção começa com ${MIN_HISTORY_DAYS} (faltam ${left}).`,
      reasons: [],
    };
  }
  return {
    state: "STABLE",
    reason: `Nenhum alerta. Saldo estimado no fim do período: ${formatBRL(p.endP50)}.`,
    reasons: [],
  };
}
