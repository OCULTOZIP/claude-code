import { addDays } from "@norbius/domain";
import { describe, expect, it } from "vitest";
import { coreState } from "../src/core-state";
import {
  anomalies,
  billsDue,
  cardLimits,
  categoryIncrease,
  detectInsights,
  goalsOffTrack,
  goalsReached,
  monthlySummary,
  projectedNegative,
  recurringDetected,
  spendingPace,
  subscriptionCreep,
  type DetectorInput,
  type Expense,
} from "../src/detectors";
import { project } from "../src/projection";

const today = "2026-09-15";
let seq = 0;
const exp = (date: string, cents: number, extra: Partial<Expense> = {}): Expense => ({
  id: `t${++seq}`,
  date,
  cents,
  categoryId: "food",
  categoryName: "Alimentação",
  categoryKey: "alimentacao",
  description: "Mercado",
  recurring: false,
  ...extra,
});

const base: DetectorInput = {
  today,
  expenses: [],
  incomes: [],
  recurringDescriptions: [],
  commitments: [],
  cards: [],
  goals: [],
  balanceCents: 300_000,
  avgMonthlyIncomeCents: null,
  historyDays: 120,
  projection: null,
};

describe("categoryIncrease", () => {
  it("dispara acima de 125% do mesmo intervalo do mês anterior e diferença ≥ R$ 50", () => {
    const input = { ...base, expenses: [exp("2026-08-05", 20_000), exp("2026-09-05", 30_000), exp("2026-09-10", 5_000)] };
    const [c] = categoryIncrease(input);
    expect(c).toMatchObject({ type: "category_increase", severity: "attention", fingerprint: "category_increase:food:2026-09" });
    expect(c!.evidence).toMatchObject({ currentCents: 35_000, previousCents: 20_000 });
    expect(c!.title).toContain("+75%");
  });

  it("ignora gasto do mês anterior depois do dia equivalente e diferenças pequenas", () => {
    expect(categoryIncrease({ ...base, expenses: [exp("2026-08-20", 20_000), exp("2026-09-05", 30_000)] })).toEqual([]);
    expect(categoryIncrease({ ...base, expenses: [exp("2026-08-05", 10_000), exp("2026-09-05", 14_000)] })).toEqual([]);
  });
});

describe("anomalies", () => {
  it("marca transação recente muito acima do típico da categoria", () => {
    const history = Array.from({ length: 10 }, (_, i) => exp(addDays(today, -20 - i * 5), 8_000 + i * 100));
    const odd = exp(addDays(today, -2), 90_000, { description: "Restaurante" });
    const out = anomalies({ ...base, expenses: [...history, odd] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "anomaly", fingerprint: `anomaly:${odd.id}`, expiresOn: addDays(odd.date, 14) });
  });

  it("precisa de amostra mínima e valor ≥ R$ 100", () => {
    expect(anomalies({ ...base, expenses: [exp(addDays(today, -1), 90_000), exp(addDays(today, -30), 5_000)] })).toEqual([]);
  });
});

describe("recurringDetected", () => {
  const netflix = (date: string, cents = 5_590) => exp(date, cents, { description: `NETFLIX.COM ${date}`, categoryId: "subs" });

  it("acha cobrança mensal parecida sem recorrência cadastrada", () => {
    const [c] = recurringDetected({ ...base, expenses: [netflix("2026-06-10"), netflix("2026-07-10"), netflix("2026-08-10", 5_790)] });
    expect(c).toMatchObject({ type: "recurring_detected", severity: "opportunity", fingerprint: "recurring_detected:netflix com" });
  });

  it("não sugere o que já está cadastrado nem intervalos irregulares", () => {
    const list = [netflix("2026-06-10"), netflix("2026-07-10"), netflix("2026-08-10")];
    expect(recurringDetected({ ...base, expenses: list, recurringDescriptions: ["Netflix.com"] })).toEqual([]);
    expect(recurringDetected({ ...base, expenses: [netflix("2026-06-10"), netflix("2026-06-20"), netflix("2026-08-10")] })).toEqual([]);
  });
});

describe("subscriptionCreep", () => {
  it("compara o último mês fechado com 3 meses antes", () => {
    const sub = (date: string, cents: number) => exp(date, cents, { categoryKey: "assinaturas", categoryName: "Assinaturas" });
    const [c] = subscriptionCreep({ ...base, expenses: [sub("2026-05-10", 10_000), sub("2026-08-10", 12_500)] });
    expect(c).toMatchObject({ fingerprint: "subscription_creep:2026-08", severity: "opportunity" });
  });
});

describe("billsDue", () => {
  const bill = { kind: "recurring" as const, id: "r1", description: "Aluguel", amountCents: 180_000, direction: "out" as const, overdue: false };

  it("atenção em até 3 dias; crítico se o saldo não cobre", () => {
    expect(billsDue({ ...base, commitments: [{ ...bill, date: "2026-09-17" }] })[0]).toMatchObject({ severity: "attention", title: "Aluguel vence em 2 dias (17/09)" });
    expect(billsDue({ ...base, balanceCents: 100_000, commitments: [{ ...bill, date: "2026-09-16" }] })[0]).toMatchObject({ severity: "critical" });
    expect(billsDue({ ...base, commitments: [{ ...bill, date: "2026-09-25" }] })).toEqual([]);
  });

  it("fatura vencida é crítica; recorrência atrasada não gera alerta", () => {
    const out = billsDue({
      ...base,
      commitments: [
        { ...bill, kind: "invoice", id: "i1", description: "Fatura Nubank", date: "2026-09-10", overdue: true },
        { ...bill, date: "2026-09-05", overdue: true },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "critical", title: "Fatura Nubank vencida" });
  });
});

describe("cardLimits", () => {
  it("80% atenção, 95% crítico", () => {
    const out = cardLimits({
      ...base,
      cards: [
        { id: "a", name: "A", usedLimitCents: 79_000, limitCents: 100_000 },
        { id: "b", name: "B", usedLimitCents: 85_000, limitCents: 100_000 },
        { id: "c", name: "C", usedLimitCents: 96_000, limitCents: 100_000 },
      ],
    });
    expect(out.map((c) => c.severity)).toEqual(["attention", "critical"]);
  });
});

describe("projectedNegative", () => {
  it("usa o p50 da projeção", () => {
    const projection = project({
      today,
      horizonEnd: "2026-09-30",
      balanceCents: 100_000,
      events: [{ date: "2026-09-20", amountCents: -180_000, label: "Aluguel", kind: "recurring", isEstimate: false }],
      variableSpending: [],
      historyDays: 60,
      incomeRegular: true,
    });
    const [c] = projectedNegative({ ...base, projection });
    expect(c).toMatchObject({ type: "projected_negative", severity: "critical", title: "Saldo pode ficar negativo por volta de 20/09" });
    expect(projectedNegative({ ...base, projection: null })).toEqual([]);
  });
});

describe("metas", () => {
  const goal = { id: "g1", name: "Viagem", status: "active" as const, targetAmountCents: 600_000, currentAmountCents: 100_000, targetDate: "2027-03-15", monthlyNeededCents: 83_334, completedOn: null, contributions90Cents: 60_000 };

  it("fora do ritmo quando o necessário passa de 1,5× a média de aportes", () => {
    expect(goalsOffTrack({ ...base, goals: [goal] })[0]).toMatchObject({ type: "goal_off_track", fingerprint: "goal_off_track:g1:2026-09" });
    expect(goalsOffTrack({ ...base, goals: [{ ...goal, contributions90Cents: 200_000 }] })).toEqual([]);
  });

  it("meta atingida é informativa e expira", () => {
    const [c] = goalsReached({ ...base, goals: [{ ...goal, currentAmountCents: 600_000, completedOn: "2026-09-14" }] });
    expect(c).toMatchObject({ severity: "info", expiresOn: "2026-09-21" });
    expect(goalsReached({ ...base, goals: [{ ...goal, currentAmountCents: 600_000, completedOn: "2026-08-01" }] })).toEqual([]);
  });
});

describe("ritmo e resumo", () => {
  it("ritmo do mês acima da renda média", () => {
    const [c] = spendingPace({ ...base, avgMonthlyIncomeCents: 300_000, expenses: [exp("2026-09-02", 200_000)] });
    expect(c).toMatchObject({ type: "spending_pace", evidence: { projectedCents: 400_000 } });
    expect(spendingPace({ ...base, avgMonthlyIncomeCents: null, expenses: [exp("2026-09-02", 200_000)] })).toEqual([]);
  });

  it("resumo do mês anterior só na primeira semana", () => {
    const input = { ...base, today: "2026-10-03", incomes: [{ date: "2026-09-05", cents: 500_000 }], expenses: [exp("2026-09-10", 120_000)] };
    const [c] = monthlySummary(input);
    expect(c).toMatchObject({ fingerprint: "monthly_summary:2026-09", expiresOn: "2026-10-10" });
    expect(c!.body).toContain("sobraram");
    expect(monthlySummary({ ...input, today: "2026-10-12" })).toEqual([]);
  });
});

describe("detectInsights", () => {
  it("plano Grátis recebe só os tipos básicos", () => {
    const input = {
      ...base,
      cards: [{ id: "c", name: "C", usedLimitCents: 96_000, limitCents: 100_000 }],
      expenses: [exp("2026-08-05", 20_000), exp("2026-09-05", 40_000)],
    };
    expect(detectInsights(input, "pro").map((c) => c.type).sort()).toEqual(["card_limit", "category_increase"]);
    expect(detectInsights(input, "free").map((c) => c.type)).toEqual(["card_limit"]);
  });
});

describe("coreState", () => {
  const insight = (severity: "critical" | "attention" | "opportunity" | "info", title = "X") => ({ id: title, type: "card_limit" as const, severity, title });

  it("segue a prioridade ANALYZING > ATTENTION > OPTIMIZING > STABLE > ACTIVE", () => {
    const projection = project({ today, horizonEnd: "2026-09-30", balanceCents: 1_000, events: [], variableSpending: [], historyDays: 60, incomeRegular: true });
    const args = { hasAccounts: true, historyDays: 60, projection };
    expect(coreState({ ...args, analyzing: true, insights: [insight("critical")] }).state).toBe("ANALYZING");
    expect(coreState({ ...args, insights: [insight("opportunity", "O"), insight("critical", "Fatura vencida")] })).toMatchObject({
      state: "ATTENTION",
      reason: "Fatura vencida.",
    });
    expect(coreState({ ...args, insights: [insight("opportunity", "Meta fora do ritmo")] }).state).toBe("OPTIMIZING");
    expect(coreState({ ...args, insights: [insight("info")] }).state).toBe("STABLE");
    expect(coreState({ ...args, historyDays: 5, projection: null, insights: [] })).toMatchObject({ state: "ACTIVE" });
    expect(coreState({ ...args, hasAccounts: false, insights: [] }).state).toBe("ACTIVE");
  });
});
