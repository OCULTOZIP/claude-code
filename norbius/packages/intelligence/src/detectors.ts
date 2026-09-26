import {
  addDays,
  addMonthsToMonth,
  clampedDate,
  compareDates,
  diffDays,
  formatBRL,
  monthOf,
  monthRange,
  parts,
  type IsoDate,
  type IsoMonth,
} from "@norbius/domain";
import type { Projection } from "./projection";
import { mad, median, normalizeDescription, robustZ } from "./stats";

export const INSIGHT_TYPES = [
  "category_increase",
  "anomaly",
  "recurring_detected",
  "subscription_creep",
  "bill_due",
  "card_limit",
  "projected_negative",
  "goal_off_track",
  "goal_reached",
  "spending_pace",
  "monthly_summary",
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];
export type Severity = "info" | "opportunity" | "attention" | "critical";

/** Plano Grátis recebe só estes; o Pro recebe todos (BLUEPRINT §13). */
export const FREE_INSIGHT_TYPES: readonly InsightType[] = ["bill_due", "card_limit", "goal_reached", "monthly_summary"];

/**
 * Insights de condição somem (resolved) quando a condição deixa de valer;
 * os de evento ficam até expirar ou serem dispensados.
 */
export const EVENT_INSIGHT_TYPES: readonly InsightType[] = ["anomaly", "goal_reached", "monthly_summary"];

export type InsightCandidate = {
  type: InsightType;
  severity: Severity;
  title: string;
  body: string;
  /** Números e ids que sustentam o insight (auditável). */
  evidence: Record<string, unknown>;
  /** type + escopo + período: evita duplicatas. */
  fingerprint: string;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  /** Só para insights de evento. */
  expiresOn?: IsoDate;
};

export type Expense = {
  id: string;
  date: IsoDate;
  cents: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryKey: string | null;
  description: string;
  /** Já coberto por uma recorrência cadastrada. */
  recurring: boolean;
};

export type DetectorInput = {
  today: IsoDate;
  /** Despesas (contas + compras no cartão pelo valor total), últimos ~120 dias. */
  expenses: Expense[];
  /** Receitas registradas, últimos ~120 dias (resumo mensal). */
  incomes: { date: IsoDate; cents: number }[];
  /** Descrições das recorrências cadastradas (normalização feita aqui). */
  recurringDescriptions: string[];
  commitments: {
    kind: "recurring" | "invoice" | "scheduled";
    id: string;
    description: string;
    date: IsoDate;
    amountCents: number;
    direction: "in" | "out";
    overdue: boolean;
  }[];
  cards: { id: string; name: string; usedLimitCents: number; limitCents: number }[];
  goals: {
    id: string;
    name: string;
    status: "active" | "completed" | "archived";
    targetAmountCents: number;
    currentAmountCents: number;
    targetDate: IsoDate | null;
    monthlyNeededCents: number | null;
    completedOn: IsoDate | null;
    /** Aportes líquidos dos últimos 90 dias. */
    contributions90Cents: number;
  }[];
  balanceCents: number;
  avgMonthlyIncomeCents: number | null;
  historyDays: number;
  /** null quando o histórico é curto demais para projetar. */
  projection: Projection | null;
};

const brl = formatBRL;
const br = (d: IsoDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const monthName = (m: IsoMonth) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`));

function sumBetween(expenses: Expense[], start: IsoDate, end: IsoDate, pick: (e: Expense) => boolean = () => true) {
  return expenses.filter((e) => e.date >= start && e.date <= end && pick(e)).reduce((s, e) => s + e.cents, 0);
}

/** Gasto da categoria até o dia D > 125% do mesmo intervalo no mês anterior e diferença ≥ R$ 50. */
export function categoryIncrease(input: DetectorInput): InsightCandidate[] {
  const { today } = input;
  const day = parts(today).day;
  if (day < 5) return [];
  const month = monthOf(today);
  const { start } = monthRange(month);
  const prevMonth = addMonthsToMonth(month, -1);
  const prevStart = monthRange(prevMonth).start;
  const prevEnd = clampedDate(Number(prevMonth.slice(0, 4)), Number(prevMonth.slice(5, 7)), day);
  const cats = new Map<string, string>();
  for (const e of input.expenses) if (e.categoryId) cats.set(e.categoryId, e.categoryName ?? "Categoria");
  const out: InsightCandidate[] = [];
  for (const [categoryId, name] of cats) {
    const now = sumBetween(input.expenses, start, today, (e) => e.categoryId === categoryId);
    const before = sumBetween(input.expenses, prevStart, prevEnd, (e) => e.categoryId === categoryId);
    if (before <= 0 || now <= before * 1.25 || now - before < 5000) continue;
    const ratio = now / before - 1;
    out.push({
      type: "category_increase",
      severity: ratio >= 0.5 ? "attention" : "opportunity",
      title: `${name} +${pct(ratio)} vs. ${monthName(prevMonth)}`,
      body: `Até dia ${day}, você gastou ${brl(now)} com ${name.toLowerCase()}, contra ${brl(before)} no mesmo período de ${monthName(prevMonth)} (+${brl(now - before)}).`,
      evidence: { categoryId, currentCents: now, previousCents: before, period: { start, end: today }, previousPeriod: { start: prevStart, end: prevEnd } },
      fingerprint: `category_increase:${categoryId}:${month}`,
      periodStart: start,
      periodEnd: today,
    });
  }
  return out;
}

/** Transação recente com z-score robusto > 3,5 na categoria (90 dias) e ≥ R$ 100. */
export function anomalies(input: DetectorInput): InsightCandidate[] {
  const since = addDays(input.today, -90);
  const recentFrom = addDays(input.today, -7);
  const byCat = new Map<string, Expense[]>();
  for (const e of input.expenses) {
    if (!e.categoryId || e.recurring || e.date < since) continue;
    byCat.set(e.categoryId, [...(byCat.get(e.categoryId) ?? []), e]);
  }
  const out: InsightCandidate[] = [];
  for (const list of byCat.values()) {
    if (list.length < 5) continue;
    const values = list.map((e) => e.cents);
    const m = median(values);
    const dev = mad(values, m);
    for (const e of list) {
      if (e.date < recentFrom || e.cents < 10000) continue;
      const z = robustZ(e.cents, m, dev);
      if (z <= 3.5) continue;
      out.push({
        type: "anomaly",
        severity: "attention",
        title: `Gasto fora do padrão em ${e.categoryName ?? "uma categoria"}`,
        body: `${e.description} (${brl(e.cents)}, ${br(e.date)}) está bem acima do seu gasto típico nessa categoria, que fica em torno de ${brl(Math.round(m))}.`,
        evidence: { transactionId: e.id, amountCents: e.cents, categoryId: e.categoryId, medianCents: Math.round(m), madCents: Math.round(dev), robustZ: Number(z.toFixed(2)), sampleSize: list.length },
        fingerprint: `anomaly:${e.id}`,
        periodStart: e.date,
        periodEnd: e.date,
        expiresOn: addDays(e.date, 14),
      });
    }
  }
  return out;
}

/** ≥ 3 ocorrências da mesma descrição, valor ±10%, intervalo de 28–33 dias, sem recorrência cadastrada. */
export function recurringDetected(input: DetectorInput): InsightCandidate[] {
  const known = new Set(input.recurringDescriptions.map(normalizeDescription));
  const groups = new Map<string, Expense[]>();
  for (const e of input.expenses) {
    if (e.recurring) continue;
    const key = normalizeDescription(e.description);
    if (key.length < 3 || known.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: InsightCandidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => compareDates(a.date, b.date)).slice(-4);
    const m = median(sorted.map((e) => e.cents));
    const similar = sorted.every((e) => Math.abs(e.cents - m) <= m * 0.1);
    const gaps = sorted.slice(1).map((e, i) => diffDays(e.date, sorted[i]!.date));
    const monthly = gaps.every((g) => g >= 28 && g <= 33);
    if (!similar || !monthly) continue;
    const last = sorted.at(-1)!;
    out.push({
      type: "recurring_detected",
      severity: "opportunity",
      title: `${last.description} parece uma conta mensal`,
      body: `Encontrei ${sorted.length} lançamentos de cerca de ${brl(Math.round(m))} com intervalo mensal. Cadastre como conta fixa para o NORBIUS prever esse gasto.`,
      evidence: { description: key, transactionIds: sorted.map((e) => e.id), amountsCents: sorted.map((e) => e.cents), dates: sorted.map((e) => e.date), gapsDays: gaps },
      fingerprint: `recurring_detected:${key}`,
      periodStart: sorted[0]!.date,
      periodEnd: last.date,
    });
  }
  return out;
}

/** Categoria Assinaturas cresceu ≥ 20% em 3 meses (último mês fechado vs. 3 meses antes). */
export function subscriptionCreep(input: DetectorInput): InsightCandidate[] {
  const month = monthOf(input.today);
  const last = addMonthsToMonth(month, -1);
  const base = addMonthsToMonth(month, -4);
  const isSub = (e: Expense) => e.categoryKey === "assinaturas";
  const total = (m: IsoMonth) => sumBetween(input.expenses, monthRange(m).start, monthRange(m).end, isSub);
  const now = total(last);
  const before = total(base);
  if (before <= 0 || now < before * 1.2) return [];
  return [
    {
      type: "subscription_creep",
      severity: "opportunity",
      title: `Assinaturas subiram ${pct(now / before - 1)} em 3 meses`,
      body: `Em ${monthName(last)} você gastou ${brl(now)} com assinaturas, contra ${brl(before)} em ${monthName(base)}. Vale revisar o que ainda usa.`,
      evidence: { currentMonth: last, currentCents: now, baseMonth: base, baseCents: before },
      fingerprint: `subscription_creep:${last}`,
      periodStart: monthRange(base).start,
      periodEnd: monthRange(last).end,
    },
  ];
}

/** Conta ou fatura vencendo em até 3 dias (crítico se o saldo previsto não cobre); fatura vencida. */
export function billsDue(input: DetectorInput): InsightCandidate[] {
  const until = addDays(input.today, 3);
  const out: InsightCandidate[] = [];
  for (const c of input.commitments) {
    if (c.direction !== "out" || c.kind === "scheduled" || compareDates(c.date, until) > 0) continue;
    const overdueInvoice = c.kind === "invoice" && c.overdue;
    if (c.overdue && !overdueInvoice) continue; // recorrência não registrada: pode já ter sido paga por fora
    const balanceThen = balanceBefore(input, c.date);
    const short = balanceThen < c.amountCents;
    const days = diffDays(c.date, input.today);
    const when = overdueInvoice ? `venceu em ${br(c.date)}` : days === 0 ? "vence hoje" : days === 1 ? "vence amanhã" : `vence em ${days} dias (${br(c.date)})`;
    out.push({
      type: "bill_due",
      severity: overdueInvoice || short ? "critical" : "attention",
      title: overdueInvoice ? `${c.description} vencida` : `${c.description} ${when}`,
      body: `${c.description} de ${brl(c.amountCents)} ${when}.${short ? ` O saldo previsto para a data (${brl(balanceThen)}) não cobre o valor.` : ""}`,
      evidence: { kind: c.kind, id: c.id, dueDate: c.date, amountCents: c.amountCents, expectedBalanceCents: balanceThen },
      fingerprint: `bill_due:${c.kind}:${c.id}:${c.date}`,
      periodStart: c.date,
      periodEnd: c.date,
    });
  }
  return out;
}

/** Saldo provável na véspera de `date` (projeção p50, ou o saldo de hoje sem projeção). */
function balanceBefore(input: DetectorInput, date: IsoDate) {
  const prev = addDays(date, -1);
  const day = input.projection?.days.find((d) => d.date === prev);
  return day ? day.p50 : input.balanceCents;
}

/** Uso do limite ≥ 80% (atenção) ou ≥ 95% (crítico). */
export function cardLimits(input: DetectorInput): InsightCandidate[] {
  const month = monthOf(input.today);
  return input.cards
    .filter((c) => c.limitCents > 0 && c.usedLimitCents / c.limitCents >= 0.8)
    .map((c) => {
      const usage = c.usedLimitCents / c.limitCents;
      return {
        type: "card_limit" as const,
        severity: usage >= 0.95 ? ("critical" as const) : ("attention" as const),
        title: `${c.name}: ${pct(usage)} do limite usado`,
        body: `Você usou ${brl(c.usedLimitCents)} de ${brl(c.limitCents)}. Restam ${brl(Math.max(0, c.limitCents - c.usedLimitCents))} de limite.`,
        evidence: { cardId: c.id, usedCents: c.usedLimitCents, limitCents: c.limitCents, usage: Number(usage.toFixed(3)) },
        fingerprint: `card_limit:${c.id}:${month}`,
      };
    });
}

/** Saldo provável (p50) negativo em algum dia do horizonte. */
export function projectedNegative(input: DetectorInput): InsightCandidate[] {
  const p = input.projection;
  const low = p?.lowestP50;
  if (!p || !low || low.cents >= 0) return [];
  const first = p.days.find((d) => d.p50 < 0)!;
  return [
    {
      type: "projected_negative",
      severity: "critical",
      title: `Saldo pode ficar negativo por volta de ${br(first.date)}`,
      body: `Pela projeção, seu saldo fica negativo a partir de ${br(first.date)} e chega a cerca de − ${brl(Math.abs(low.cents))} em ${br(low.date)}. É uma estimativa (confiança ${p.confidence === "high" ? "alta" : p.confidence === "medium" ? "média" : "baixa"}).`,
      evidence: { firstNegativeDate: first.date, lowestDate: low.date, lowestP50Cents: low.cents, p10Cents: first.p10, p90Cents: first.p90, confidence: p.confidence, methodVersion: p.methodVersion },
      fingerprint: `projected_negative:${monthOf(input.today)}`,
      periodStart: addDays(input.today, 1),
      periodEnd: p.horizonEnd,
    },
  ];
}

/** Aporte necessário por mês > 1,5× a média de aportes dos últimos 3 meses. */
export function goalsOffTrack(input: DetectorInput): InsightCandidate[] {
  if (input.historyDays < 30) return [];
  const month = monthOf(input.today);
  const out: InsightCandidate[] = [];
  for (const g of input.goals) {
    if (g.status !== "active" || !g.targetDate || !g.monthlyNeededCents) continue;
    const avg = Math.round(g.contributions90Cents / 3);
    if (g.monthlyNeededCents <= avg * 1.5) continue;
    out.push({
      type: "goal_off_track",
      severity: "opportunity",
      title: `Meta ${g.name} fora do ritmo`,
      body: `Para chegar a ${brl(g.targetAmountCents)} até ${br(g.targetDate)}${g.targetDate.slice(0, 4) !== input.today.slice(0, 4) ? `/${g.targetDate.slice(0, 4)}` : ""}, faltam ${brl(g.monthlyNeededCents)} por mês; seus aportes recentes somam ${brl(avg)} por mês.`,
      evidence: { goalId: g.id, monthlyNeededCents: g.monthlyNeededCents, avgMonthlyContributionCents: avg, currentCents: g.currentAmountCents, targetCents: g.targetAmountCents, targetDate: g.targetDate },
      fingerprint: `goal_off_track:${g.id}:${month}`,
    });
  }
  return out;
}

/** Meta atingida (valor ≥ alvo) nos últimos 7 dias. */
export function goalsReached(input: DetectorInput): InsightCandidate[] {
  return input.goals
    .filter((g) => g.status !== "archived" && g.currentAmountCents >= g.targetAmountCents)
    .filter((g) => !g.completedOn || diffDays(input.today, g.completedOn) <= 7)
    .map((g) => ({
      type: "goal_reached" as const,
      severity: "info" as const,
      title: `Meta ${g.name} atingida`,
      body: `Você chegou a ${brl(g.currentAmountCents)} de ${brl(g.targetAmountCents)}. Parabéns!`,
      evidence: { goalId: g.id, currentCents: g.currentAmountCents, targetCents: g.targetAmountCents },
      fingerprint: `goal_reached:${g.id}`,
      expiresOn: addDays(g.completedOn ?? input.today, 7),
    }));
}

/** Ritmo do mês projeta despesa total acima da renda média declarada. */
export function spendingPace(input: DetectorInput): InsightCandidate[] {
  const income = input.avgMonthlyIncomeCents;
  const { day } = parts(input.today);
  if (!income || day < 7) return [];
  const month = monthOf(input.today);
  const { start, end } = monthRange(month);
  const spent = sumBetween(input.expenses, start, input.today);
  const daysInMonth = parts(end).day;
  const projected = Math.round((spent / day) * daysInMonth);
  if (projected <= income) return [];
  return [
    {
      type: "spending_pace",
      severity: "attention",
      title: "Ritmo de gastos acima da renda",
      body: `No ritmo atual, as despesas do mês devem chegar a cerca de ${brl(projected)}, acima da sua renda média de ${brl(income)}. Até agora foram ${brl(spent)} em ${day} dias.`,
      evidence: { spentCents: spent, days: day, daysInMonth, projectedCents: projected, avgMonthlyIncomeCents: income },
      fingerprint: `spending_pace:${month}`,
      periodStart: start,
      periodEnd: end,
    },
  ];
}

/** Resumo do mês anterior, nos primeiros 7 dias do mês. */
export function monthlySummary(input: DetectorInput): InsightCandidate[] {
  if (parts(input.today).day > 7) return [];
  const prev = addMonthsToMonth(monthOf(input.today), -1);
  const { start, end } = monthRange(prev);
  const expense = sumBetween(input.expenses, start, end);
  const income = input.incomes.filter((i) => i.date >= start && i.date <= end).reduce((s, i) => s + i.cents, 0);
  if (!expense && !income) return [];
  const byCat = new Map<string, number>();
  for (const e of input.expenses) if (e.date >= start && e.date <= end) byCat.set(e.categoryName ?? "Sem categoria", (byCat.get(e.categoryName ?? "Sem categoria") ?? 0) + e.cents);
  const top = [...byCat].sort((a, b) => b[1] - a[1])[0];
  const result = income - expense;
  return [
    {
      type: "monthly_summary",
      severity: "info",
      title: `Resumo de ${monthName(prev)}`,
      body: `Receitas ${brl(income)}, despesas ${brl(expense)}: ${result >= 0 ? `sobraram ${brl(result)}` : `faltaram ${brl(-result)}`}.${top ? ` Maior categoria: ${top[0]} (${brl(top[1])}).` : ""}`,
      evidence: { month: prev, incomeCents: income, expenseCents: expense, resultCents: result, topCategory: top ? { name: top[0], cents: top[1] } : null },
      fingerprint: `monthly_summary:${prev}`,
      periodStart: start,
      periodEnd: end,
      expiresOn: addDays(input.today, 10 - parts(input.today).day),
    },
  ];
}

const DETECTORS = [
  categoryIncrease,
  anomalies,
  recurringDetected,
  subscriptionCreep,
  billsDue,
  cardLimits,
  projectedNegative,
  goalsOffTrack,
  goalsReached,
  spendingPace,
  monthlySummary,
];

/** Roda todos os detectores (determinísticos). O plano filtra os tipos. */
export function detectInsights(input: DetectorInput, plan: "free" | "pro"): InsightCandidate[] {
  const all = DETECTORS.flatMap((d) => d(input));
  return plan === "pro" ? all : all.filter((c) => FREE_INSIGHT_TYPES.includes(c.type));
}
