import { addDays } from "@norbius/domain";
import { describe, expect, it } from "vitest";
import { confidenceFor, historicalDays, project, type ProjectionInput } from "../src/projection";
import { safeToSpend } from "../src/safe-to-spend";

const today = "2026-09-15";

function spending(days: number, cents: (i: number) => number) {
  return Array.from({ length: days }, (_, i) => ({ date: addDays(today, -(i + 1)), cents: cents(i) }));
}

const base: ProjectionInput = {
  today,
  horizonEnd: "2026-09-30",
  balanceCents: 500_000,
  events: [],
  variableSpending: [],
  historyDays: 120,
  incomeRegular: true,
};

describe("project", () => {
  it("sem gasto variável, segue só os eventos conhecidos (sem incerteza)", () => {
    const p = project({
      ...base,
      events: [
        { date: "2026-09-20", amountCents: -180_000, label: "Aluguel", kind: "recurring", isEstimate: false },
        { date: "2026-09-25", amountCents: 300_000, label: "Salário", kind: "recurring", isEstimate: false },
      ],
    });
    expect(p.days).toHaveLength(15);
    expect(p.days[0]).toMatchObject({ date: "2026-09-16", p10: 500_000, p50: 500_000, p90: 500_000 });
    expect(p.days.find((d) => d.date === "2026-09-20")!.p50).toBe(320_000);
    expect(p.endP50).toBe(620_000);
    expect(p.lowestP50).toEqual({ date: "2026-09-20", cents: 320_000 });
  });

  it("gasto variável desce a curva e abre a faixa p10 ≤ p50 ≤ p90", () => {
    const p = project({ ...base, variableSpending: spending(90, (i) => (i % 3 === 0 ? 12_000 : 3_000)) });
    for (const d of p.days) {
      expect(d.p10).toBeLessThanOrEqual(d.p50);
      expect(d.p50).toBeLessThanOrEqual(d.p90);
    }
    expect(p.endP50).toBeLessThan(base.balanceCents);
    expect(p.dailyVariableCents).toBe(6_000);
    expect(p.days.at(-1)!.p90 - p.days.at(-1)!.p10).toBeGreaterThan(0);
  });

  it("é determinística para a mesma entrada", () => {
    const input = { ...base, variableSpending: spending(60, (i) => (i * 7919) % 20_000) };
    expect(project(input)).toEqual(project(input));
  });

  it("evento atrasado conta no primeiro dia projetado", () => {
    const p = project({ ...base, events: [{ date: "2026-09-10", amountCents: -50_000, label: "Luz", kind: "recurring", isEstimate: false }] });
    expect(p.days[0]!.p50).toBe(450_000);
    expect(p.assumptions.some((a) => a.includes("atrasado desde 10/09"))).toBe(true);
  });

  it("limita dias fora do padrão (MAD) sem descartá-los", () => {
    const hist = historicalDays({ today, historyDays: 60, variableSpending: [...spending(59, () => 5_000), { date: addDays(today, -3), cents: 1_000_000 }] });
    expect(Math.max(...hist.map((d) => d.cents))).toBeLessThan(1_005_000);
    expect(hist).toHaveLength(59);
  });

  it("confiança depende do histórico e da regularidade da renda", () => {
    expect(confidenceFor(20, true)).toBe("low");
    expect(confidenceFor(60, true)).toBe("medium");
    expect(confidenceFor(120, true)).toBe("high");
    expect(confidenceFor(120, false)).toBe("low");
  });
});

describe("safeToSpend", () => {
  const events = [
    { date: "2026-09-20", amountCents: -180_000, label: "Aluguel", kind: "recurring" as const, isEstimate: false },
    { date: "2026-10-05", amountCents: 600_000, label: "Salário", kind: "recurring" as const, isEstimate: false },
    { date: "2026-10-10", amountCents: -90_000, label: "Fatura", kind: "invoice" as const, isEstimate: true },
  ];

  it("vai até a véspera da próxima receita e desconta compromissos, metas e reserva", () => {
    const s = safeToSpend({ today, balanceCents: 500_000, events, goalsMonthlyCents: 30_000, avgMonthlyIncomeCents: 600_000, dailyVariableCents: 5_000, confidence: "high" });
    expect(s.until).toBe("2026-10-04");
    expect(s.basis).toBe("next_income");
    expect(s.days).toBe(20);
    expect(s.fixedCents).toBe(180_000); // a fatura de 10/10 fica fora
    expect(s.goalsCents).toBe(20_000);
    expect(s.reserveCents).toBe(60_000);
    expect(s.availableCents).toBe(500_000 - 180_000 - 20_000 - 60_000);
    expect(s.perDayCents).toBe(12_000);
    expect(s.perWeekCents).toBe(84_000);
    expect(s.kind).toBe("estimate");
  });

  it("sem receita prevista, vai até o fim do mês e nunca sugere valor negativo por dia", () => {
    const s = safeToSpend({ today, balanceCents: 10_000, events: [events[0]!], goalsMonthlyCents: 0, avgMonthlyIncomeCents: null, dailyVariableCents: 0, confidence: "low" });
    expect(s.basis).toBe("month_end");
    expect(s.until).toBe("2026-09-30");
    expect(s.availableCents).toBe(-170_000);
    expect(s.perDayCents).toBe(0);
    expect(s.assumptions.some((a) => a.includes("renda média não informada"))).toBe(true);
  });
});
