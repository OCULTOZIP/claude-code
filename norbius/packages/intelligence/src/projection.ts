import { addDays, compareDates, diffDays, formatBRL, type IsoDate } from "@norbius/domain";
import { hash32, mad, median, percentileSorted, seededRandom, weekday } from "./stats";

export const PROJECTION_METHOD_VERSION = "1";
/** Abaixo disso a projeção não é exibida: não há base para estimar gasto variável. */
export const MIN_HISTORY_DAYS = 14;
const SAMPLES = 1000;
const HISTORY_WINDOW = 90;
/** Corte de outliers: dias acima de mediana + 3,5·MAD normalizado (só dias com gasto). */
const OUTLIER_K = 3.5 * 1.4826;

export type Confidence = "low" | "medium" | "high";

/** Evento com data conhecida: receita/conta fixa, fatura, lançamento agendado. */
export type KnownEvent = {
  date: IsoDate;
  /** Positivo = entra; negativo = sai. */
  amountCents: number;
  label: string;
  kind: "recurring" | "invoice" | "scheduled";
  isEstimate: boolean;
};

export type ProjectionInput = {
  today: IsoDate;
  horizonEnd: IsoDate;
  /** Saldo disponível hoje (contas do dia a dia). */
  balanceCents: number;
  /** Eventos datados. Atrasados (data < hoje) contam no primeiro dia projetado. */
  events: KnownEvent[];
  /** Gasto variável por dia (não recorrente, positivo), qualquer período; usa os últimos 90 dias antes de hoje. */
  variableSpending: { date: IsoDate; cents: number }[];
  /** Dias desde o primeiro registro (inclusive hoje). */
  historyDays: number;
  /** Renda regular (mensal/quinzenal/semanal com recorrência cadastrada). */
  incomeRegular: boolean;
};

export type ProjectionDay = { date: IsoDate; p10: number; p50: number; p90: number };

export type Projection = {
  methodVersion: string;
  today: IsoDate;
  horizonEnd: IsoDate;
  confidence: Confidence;
  /** Série diária a partir de amanhã (centavos, saldo projetado). */
  days: ProjectionDay[];
  /** Gasto variável médio por dia usado na estimativa. */
  dailyVariableCents: number;
  /** Menor saldo provável (p50) no horizonte. */
  lowestP50: { date: IsoDate; cents: number } | null;
  endP50: number;
  assumptions: string[];
};

export function confidenceFor(historyDays: number, incomeRegular: boolean): Confidence {
  if (historyDays < 30 || !incomeRegular) return "low";
  return historyDays >= 90 ? "high" : "medium";
}

/** Dias do histórico (ontem para trás), com os gastos acima do corte de outlier limitados ao corte. */
export function historicalDays(input: Pick<ProjectionInput, "today" | "variableSpending" | "historyDays">) {
  const n = Math.max(0, Math.min(HISTORY_WINDOW, input.historyDays - 1));
  const byDate = new Map<IsoDate, number>();
  for (const s of input.variableSpending) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.cents);
  const days: { date: IsoDate; cents: number }[] = [];
  for (let i = n; i >= 1; i--) {
    const date = addDays(input.today, -i);
    days.push({ date, cents: byDate.get(date) ?? 0 });
  }
  const spent = days.map((d) => d.cents).filter((c) => c > 0);
  const m = median(spent);
  // Com muitos dias iguais o MAD zera; aí o desvio absoluto médio faz o papel de escala.
  const spread = mad(spent, m) || (spent.length ? spent.reduce((s, c) => s + Math.abs(c - m), 0) / spent.length : 0);
  const cap = spread > 0 ? m + OUTLIER_K * spread : Number.POSITIVE_INFINITY;
  return days.map((d) => ({ ...d, cents: Math.min(d.cents, cap) }));
}

/**
 * Projeção de saldo (ADR 0005): linha base determinística (saldo + eventos
 * datados) menos gasto variável simulado por bootstrap de dias históricos do
 * mesmo dia da semana. Determinística para a mesma entrada (semente = hash).
 */
export function project(input: ProjectionInput): Projection {
  const { today, horizonEnd } = input;
  const horizon = Math.max(0, diffDays(horizonEnd, today));
  const confidence = confidenceFor(input.historyDays, input.incomeRegular);

  // Eventos por dia projetado (1..horizon); atrasados caem no dia 1.
  const eventByDay = new Array<number>(horizon + 1).fill(0);
  for (const e of input.events) {
    const offset = Math.max(1, diffDays(e.date, today));
    if (offset <= horizon) eventByDay[offset]! += e.amountCents;
  }

  const hist = historicalDays(input);
  const pools = new Map<number, number[]>();
  for (const d of hist) {
    const w = weekday(d.date);
    pools.set(w, [...(pools.get(w) ?? []), d.cents]);
  }
  const all = hist.map((d) => d.cents);
  const dailyVariableCents = all.length ? Math.round(all.reduce((s, c) => s + c, 0) / all.length) : 0;

  const rand = seededRandom(hash32(JSON.stringify([today, horizonEnd, input.balanceCents, all])));
  const futureWeekdays = Array.from({ length: horizon + 1 }, (_, i) => weekday(addDays(today, i)));
  const paths: Float64Array[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const path = new Float64Array(horizon + 1);
    let balance = input.balanceCents;
    for (let i = 1; i <= horizon; i++) {
      const pool = pools.get(futureWeekdays[i]!)?.length ? pools.get(futureWeekdays[i]!)! : all;
      const spend = pool.length ? pool[Math.floor(rand() * pool.length)]! : 0;
      balance += eventByDay[i]! - spend;
      path[i] = balance;
    }
    paths.push(path);
  }

  const days: ProjectionDay[] = [];
  const column = new Float64Array(SAMPLES);
  for (let i = 1; i <= horizon; i++) {
    for (let s = 0; s < SAMPLES; s++) column[s] = paths[s]![i]!;
    const sorted = [...column].sort((a, b) => a - b);
    days.push({
      date: addDays(today, i),
      p10: Math.round(percentileSorted(sorted, 0.1)),
      p50: Math.round(percentileSorted(sorted, 0.5)),
      p90: Math.round(percentileSorted(sorted, 0.9)),
    });
  }

  const lowest = days.reduce<ProjectionDay | null>((lo, d) => (!lo || d.p50 < lo.p50 ? d : lo), null);
  return {
    methodVersion: PROJECTION_METHOD_VERSION,
    today,
    horizonEnd,
    confidence,
    days,
    dailyVariableCents,
    lowestP50: lowest ? { date: lowest.date, cents: lowest.p50 } : null,
    endP50: days.at(-1)?.p50 ?? input.balanceCents,
    assumptions: assumptions(input, hist.length, dailyVariableCents),
  };
}

function shortDate(date: IsoDate) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function assumptions(input: ProjectionInput, historyUsed: number, dailyVariableCents: number): string[] {
  const out: string[] = [`Saldo de partida: ${formatBRL(input.balanceCents)} (contas do dia a dia).`];
  const events = [...input.events]
    .filter((e) => compareDates(e.date, input.horizonEnd) <= 0)
    .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents))
    .slice(0, 6)
    .sort((a, b) => compareDates(a.date, b.date));
  for (const e of events) {
    const when = compareDates(e.date, input.today) < 0 ? `atrasado desde ${shortDate(e.date)}` : `dia ${shortDate(e.date)}`;
    out.push(`${e.label}: ${e.amountCents >= 0 ? "+" : "−"} ${formatBRL(Math.abs(e.amountCents))} ${when}${e.isEstimate ? " (estimativa)" : ""}.`);
  }
  out.push(
    historyUsed
      ? `Gasto variável médio de ${formatBRL(dailyVariableCents)}/dia, com base nos últimos ${historyUsed} dias (dias fora do padrão foram limitados).`
      : "Sem histórico suficiente de gastos variáveis; considerei apenas os compromissos conhecidos.",
  );
  out.push("Compras no cartão entram no dia da compra (antes da fatura), o que deixa a projeção mais conservadora.");
  return out;
}
