import { describe, expect, it } from "vitest";
import { invoiceForMonth, invoiceForPurchase, invoiceStatus, planInstallments } from "../src";

const cycle = { closingDay: 3, dueDay: 10 };

describe("fatura de uma compra", () => {
  it("compra antes do fechamento entra na fatura do mês", () => {
    expect(invoiceForPurchase("2026-09-02", cycle)).toEqual({
      referenceMonth: "2026-09",
      closingDate: "2026-09-03",
      dueDate: "2026-09-10",
    });
  });

  it("compra no dia do fechamento vai para a próxima fatura", () => {
    expect(invoiceForPurchase("2026-09-03", cycle).referenceMonth).toBe("2026-10");
  });

  it("vencimento antes do fechamento cai no mês seguinte", () => {
    expect(invoiceForMonth("2026-09", { closingDay: 25, dueDay: 5 })).toEqual({
      referenceMonth: "2026-09",
      closingDate: "2026-09-25",
      dueDate: "2026-10-05",
    });
  });

  it("fechamento dia 31 respeita meses curtos", () => {
    const c = { closingDay: 31, dueDay: 8 };
    expect(invoiceForMonth("2026-02", c).closingDate).toBe("2026-02-28");
    expect(invoiceForPurchase("2026-02-28", c).referenceMonth).toBe("2026-03");
    expect(invoiceForPurchase("2026-02-27", c).referenceMonth).toBe("2026-02");
  });

  it("virada de ano", () => {
    expect(invoiceForPurchase("2026-12-20", { closingDay: 15, dueDay: 22 })).toEqual({
      referenceMonth: "2027-01",
      closingDate: "2027-01-15",
      dueDate: "2027-01-22",
    });
  });
});

describe("parcelamento", () => {
  it("cada parcela vai para uma fatura consecutiva", () => {
    const plan = planInstallments("2026-11-20", [3334, 3333, 3333], cycle);
    expect(plan.map((p) => p.invoice.referenceMonth)).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(plan.map((p) => p.competenceDate)).toEqual(["2026-11-20", "2026-12-20", "2027-01-20"]);
    expect(plan.map((p) => p.installmentNumber)).toEqual([1, 2, 3]);
  });
});

describe("status da fatura", () => {
  const base = { closingDate: "2026-09-03", dueDate: "2026-09-10", totalCents: 1000 };
  it.each([
    ["2026-09-01", 0, "open"],
    ["2026-09-05", 0, "closed"],
    ["2026-09-05", 400, "partially_paid"],
    ["2026-09-05", 1000, "paid"],
    ["2026-09-11", 400, "overdue"],
    ["2026-09-11", 1000, "paid"],
  ] as const)("hoje %s, pago %i → %s", (today, paidCents, status) => {
    expect(invoiceStatus({ ...base, today, paidCents })).toBe(status);
  });
});
