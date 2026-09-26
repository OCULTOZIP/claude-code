import { createDatabase, schema } from "@norbius/db";
import { addDays, todayIn } from "@norbius/domain";
import type { IntelligenceSummary } from "@norbius/contracts";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, proClient, verifiedClient, type TestClient } from "./helpers";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const owner = createDatabase(
  process.env.DATABASE_MIGRATION_URL ?? "postgres://norbius_owner:norbius_owner@localhost:5432/norbius",
  { max: 1 },
);
const today = todayIn("America/Sao_Paulo");

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await owner.db.delete(schema.users).where(like(schema.users.email, "intel-%@test.norbius"));
  await ctx.close();
  await owner.close();
});

async function categories(client: TestClient) {
  const cats = (await client.get("/api/v1/categories")).json() as { id: string; name: string }[];
  return { food: cats.find((c) => c.name === "Alimentação")!.id, housing: cats.find((c) => c.name === "Moradia")!.id };
}

async function account(client: TestClient, initialBalanceCents: number) {
  const res = await client.post("/api/v1/accounts", { name: "Conta", type: "checking", initialBalanceCents, initialBalanceDate: addDays(today, -40) });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

async function intel(client: TestClient) {
  const res = await client.get("/api/v1/intelligence");
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as IntelligenceSummary;
}

describe("sem dados", () => {
  it("não projeta e explica o motivo; CORE ativo sem alertas", async () => {
    const { client } = await verifiedClient(ctx, "intel-vazio");
    const s = await intel(client);
    expect(s.projection).toBeNull();
    expect(s.safeToSpend).toBeNull();
    expect(s.projectionUnavailable).toContain("Cadastre suas contas");
    expect(s.core.state).toBe("ACTIVE");
    expect(s.insights).toEqual([]);
  });
});

describe("plano Grátis", () => {
  it("recebe alerta de limite do cartão, mas não os exclusivos do Pro", async () => {
    const { client } = await verifiedClient(ctx, "intel-free");
    const { food } = await categories(client);
    await account(client, 100_000);
    const card = (await client.post("/api/v1/cards", { name: "Roxinho", limitCents: 100_000, closingDay: 3, dueDay: 10 })).json() as { id: string };
    // Mês anterior baixo, mês atual alto (category_increase é só do Pro).
    await client.post("/api/v1/card-purchases", { creditCardId: card.id, description: "Mercado", totalAmountCents: 96_000, installmentCount: 1, purchaseDate: today, categoryId: food });
    const s = await intel(client);
    expect(s.insights.map((i) => i.type)).toEqual(["card_limit"]);
    expect(s.insights[0]).toMatchObject({ severity: "critical", title: "Roxinho: 96% do limite usado" });
    expect(s.core).toMatchObject({ state: "ATTENTION", reason: "Roxinho: 96% do limite usado." });
    expect(s.core.reasons[0]!.insightId).toBe(s.insights[0]!.id);
  });
});

describe("plano Pro com histórico", () => {
  let ana: TestClient;
  let bia: TestClient;
  let acc: string;
  let food: string;
  let housing: string;

  beforeAll(async () => {
    ana = (await proClient(ctx, "intel-ana")).client;
    bia = (await proClient(ctx, "intel-bia")).client;
    ({ food, housing } = await categories(ana));
    acc = await account(ana, 500_000);
    for (let i = 1; i <= 20; i++) {
      const res = await ana.post("/api/v1/transactions", { type: "expense", accountId: acc, amountCents: 5_000, categoryId: food, description: "Mercado", date: addDays(today, -i) });
      expect(res.statusCode, res.body).toBe(201);
    }
    const rent = await ana.post("/api/v1/recurring", {
      type: "expense",
      accountId: acc,
      amountCents: 180_000,
      categoryId: housing,
      description: "Aluguel",
      frequency: "monthly",
      startDate: addDays(today, 2),
    });
    expect(rent.statusCode, rent.body).toBe(201);
  });

  it("projeta o saldo com faixa e premissas, e calcula quanto dá para gastar", async () => {
    const s = await intel(ana);
    expect(s.historyDays).toBe(21);
    const p = s.projection!;
    expect(p).toMatchObject({ kind: "estimate", confidence: "low", dailyVariableCents: 5_000 });
    expect(p.days).toHaveLength(30);
    expect(p.days.every((d) => d.p10 <= d.p50 && d.p50 <= d.p90)).toBe(true);
    expect(p.assumptions.some((a) => a.startsWith("Aluguel:"))).toBe(true);
    // Sem receita cadastrada: vale até o fim do mês. Saldo 500.000 − 20 × 5.000; o aluguel entra se vencer até lá.
    const sts = s.safeToSpend!;
    expect(sts).toMatchObject({ kind: "estimate", basis: "month_end" });
    const rentInWindow = addDays(today, 2) <= sts.until;
    expect(sts.availableCents).toBe(400_000 - (rentInWindow ? 180_000 : 0));
    expect(sts.perDayCents).toBe(Math.floor(sts.availableCents / sts.days));
  });

  it("avisa a conta que vence em 2 dias e o CORE fica em atenção", async () => {
    const s = await intel(ana);
    const bill = s.insights.find((i) => i.type === "bill_due")!;
    expect(bill).toMatchObject({ severity: "attention", title: `Aluguel vence em 2 dias (${addDays(today, 2).slice(8, 10)}/${addDays(today, 2).slice(5, 7)})` });
    expect(s.core.state).toBe("ATTENTION");
  });

  it("recalcular não duplica alertas", async () => {
    const a = await intel(ana);
    const b = await intel(ana);
    expect(b.insights.map((i) => i.id)).toEqual(a.insights.map((i) => i.id));
  });

  it("dispensar esconde o alerta de vez; outro usuário não consegue dispensar", async () => {
    const bill = (await intel(ana)).insights.find((i) => i.type === "bill_due")!;
    expect((await bia.post(`/api/v1/intelligence/insights/${bill.id}/dismiss`)).statusCode).toBe(404);
    expect((await ana.post(`/api/v1/intelligence/insights/${bill.id}/dismiss`)).statusCode).toBe(204);
    const s = await intel(ana);
    expect(s.insights.some((i) => i.id === bill.id)).toBe(false);
    expect((await ana.post(`/api/v1/intelligence/insights/${bill.id}/dismiss`)).statusCode).toBe(404);
  });

  it("alerta de condição é resolvido quando a condição some", async () => {
    const card = (await ana.post("/api/v1/cards", { name: "Azul", limitCents: 100_000, closingDay: 3, dueDay: 10 })).json() as { id: string };
    const buy = (await ana.post("/api/v1/card-purchases", { creditCardId: card.id, description: "TV", totalAmountCents: 85_000, installmentCount: 1, purchaseDate: today, categoryId: food })).json() as { id: string };
    expect((await intel(ana)).insights.some((i) => i.type === "card_limit")).toBe(true);
    expect((await ana.request({ method: "DELETE", url: `/api/v1/card-purchases/${buy.id}` })).statusCode).toBeLessThan(300);
    expect((await intel(ana)).insights.some((i) => i.type === "card_limit")).toBe(false);
  });

  it("o painel usa o estado real do CORE e traz a inteligência", async () => {
    const d = (await ana.get("/api/v1/dashboard/summary")).json();
    expect(d.intelligence.projection).not.toBeNull();
    expect(d.core.state).toBe(d.intelligence.core.state);
  });
});
