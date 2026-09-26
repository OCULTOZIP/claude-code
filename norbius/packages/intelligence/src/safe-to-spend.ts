import { addDays, compareDates, diffDays, formatBRL, monthRange, monthOf, type IsoDate } from "@norbius/domain";
import type { Confidence, KnownEvent } from "./projection";

/** Reserva padrão: 10% da renda média declarada (0 se não informada). */
export const DEFAULT_RESERVE_SHARE = 0.1;

export type SafeToSpendInput = {
  today: IsoDate;
  balanceCents: number;
  events: KnownEvent[];
  /** Aporte mensal necessário somado das metas ativas com prazo. */
  goalsMonthlyCents: number;
  avgMonthlyIncomeCents: number | null;
  /** Gasto variável médio atual (para comparar com o disponível). */
  dailyVariableCents: number;
  confidence: Confidence;
};

export type SafeToSpend = {
  /** Até quando vale o valor (véspera da próxima receita ou fim do mês). */
  until: IsoDate;
  basis: "next_income" | "month_end";
  days: number;
  /** Disponível para gastos variáveis até `until` (pode ser negativo). */
  availableCents: number;
  perDayCents: number;
  perWeekCents: number;
  reserveCents: number;
  goalsCents: number;
  fixedCents: number;
  confidence: Confidence;
  assumptions: string[];
  kind: "estimate";
};

/**
 * "Quanto posso gastar?" (ADR 0005): saldo de hoje + entradas e saídas já
 * conhecidas até a véspera da próxima receita − aportes planejados em metas −
 * reserva de segurança. O resultado é o orçamento para gastos variáveis.
 */
export function safeToSpend(input: SafeToSpendInput): SafeToSpend {
  const { today } = input;
  const nextIncome = input.events
    .filter((e) => e.amountCents > 0 && compareDates(e.date, today) > 0)
    .sort((a, b) => compareDates(a.date, b.date))[0];
  const until = nextIncome ? addDays(nextIncome.date, -1) : monthRange(monthOf(today)).end;
  const days = Math.max(1, diffDays(until, today) + 1);

  // Atrasados contam como devidos agora; nada depois de `until`.
  const window = input.events.filter((e) => compareDates(e.date, until) <= 0);
  const fixedCents = window.reduce((s, e) => s + (e.amountCents < 0 ? -e.amountCents : 0), 0);
  const inflowCents = window.reduce((s, e) => s + (e.amountCents > 0 ? e.amountCents : 0), 0);
  const goalsCents = Math.round((input.goalsMonthlyCents * days) / 30);
  const reserveCents = Math.round((input.avgMonthlyIncomeCents ?? 0) * DEFAULT_RESERVE_SHARE);
  const availableCents = input.balanceCents + inflowCents - fixedCents - goalsCents - reserveCents;
  const perDayCents = Math.max(0, Math.floor(availableCents / days));

  const assumptions = [
    `Saldo de hoje: ${formatBRL(input.balanceCents)}.`,
    fixedCents ? `Compromissos até ${br(until)}: − ${formatBRL(fixedCents)}.` : `Nenhum compromisso conhecido até ${br(until)}.`,
  ];
  if (inflowCents) assumptions.push(`Entradas previstas até ${br(until)}: + ${formatBRL(inflowCents)}.`);
  if (goalsCents) assumptions.push(`Aportes planejados em metas no período: − ${formatBRL(goalsCents)}.`);
  assumptions.push(
    reserveCents
      ? `Reserva de segurança (10% da renda média): − ${formatBRL(reserveCents)}.`
      : "Sem reserva de segurança: renda média não informada.",
  );
  assumptions.push(
    nextIncome
      ? `Vale até a véspera da próxima receita (${nextIncome.label}, ${br(nextIncome.date)}).`
      : "Não encontrei uma próxima receita cadastrada; considerei até o fim do mês.",
  );
  if (input.dailyVariableCents)
    assumptions.push(`No seu ritmo recente você gasta cerca de ${formatBRL(input.dailyVariableCents)}/dia em gastos variáveis.`);

  return {
    until,
    basis: nextIncome ? "next_income" : "month_end",
    days,
    availableCents,
    perDayCents,
    perWeekCents: perDayCents * 7,
    reserveCents,
    goalsCents,
    fixedCents,
    confidence: input.confidence,
    assumptions,
    kind: "estimate",
  };
}

function br(date: IsoDate) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
