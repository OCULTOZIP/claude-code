import { describe, expect, it } from "vitest";
import { entitlements, extendPaidThrough, periodEnd, trialEnd, type SubscriptionState } from "../src/billing";
import { isValidCnpj, isValidCpf } from "../src/tax-id";

const base: SubscriptionState = { status: "none", trialEndsOn: null, paidThrough: null, cancelAtPeriodEnd: false };

describe("entitlements", () => {
  it("sem assinatura: plano grátis, sem assistente e até 3 metas", () => {
    expect(entitlements(base, "2026-09-26")).toMatchObject({ plan: "free", assistant: false, maxActiveGoals: 3 });
  });

  it("teste grátis de 7 dias, inclusive o último dia", () => {
    const s = { ...base, status: "trialing" as const, trialEndsOn: trialEnd("2026-09-26") };
    expect(s.trialEndsOn).toBe("2026-10-02");
    expect(entitlements(s, "2026-10-02")).toMatchObject({ plan: "pro", reason: "trial" });
    expect(entitlements(s, "2026-10-03").plan).toBe("free");
  });

  it("pago até o fim do período, mesmo cancelado", () => {
    const s = { ...base, status: "canceled" as const, paidThrough: "2026-10-25", cancelAtPeriodEnd: true };
    expect(entitlements(s, "2026-10-25")).toMatchObject({ plan: "pro", reason: "paid", proUntil: "2026-10-25" });
    expect(entitlements(s, "2026-10-26").plan).toBe("free");
  });

  it("carência de 7 dias só para cobrança em atraso", () => {
    const late = { ...base, status: "past_due" as const, paidThrough: "2026-10-25" };
    expect(entitlements(late, "2026-11-01")).toMatchObject({ plan: "pro", reason: "grace", proUntil: "2026-11-01" });
    expect(entitlements(late, "2026-11-02").plan).toBe("free");
    expect(entitlements({ ...late, status: "canceled" }, "2026-10-27").plan).toBe("free");
  });
});

describe("períodos", () => {
  it("mensal e anual cobrem até a véspera do próximo vencimento", () => {
    expect(periodEnd("2026-09-26", "monthly")).toBe("2026-10-25");
    expect(periodEnd("2026-01-31", "monthly")).toBe("2026-02-27");
    expect(periodEnd("2026-09-26", "yearly")).toBe("2027-09-25");
  });

  it("webhook atrasado nunca encurta a cobertura", () => {
    expect(extendPaidThrough("2026-11-25", "2026-09-26", "monthly")).toBe("2026-11-25");
    expect(extendPaidThrough(null, "2026-09-26", "monthly")).toBe("2026-10-25");
  });
});

describe("CPF/CNPJ", () => {
  it("valida dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
  });
});
