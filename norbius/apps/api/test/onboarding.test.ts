import { createDatabase, schema } from "@norbius/db";
import { todayIn } from "@norbius/domain";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, verifiedClient } from "./helpers";

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
  await owner.db.delete(schema.users).where(like(schema.users.email, "onb-%@test.norbius"));
  await ctx.close();
  await owner.close();
});

describe("onboarding", () => {
  it("salva rascunho, conclui criando tudo e devolve o resumo", async () => {
    const { client } = await verifiedClient(ctx, "onb-full");
    expect((await client.get("/api/v1/onboarding")).json().status).toBe("not_started");
    const draft = await client.request({ method: "PUT", url: "/api/v1/onboarding/draft", payload: { step: "income", data: { name: "Ana" } } });
    expect(draft.json()).toMatchObject({ status: "in_progress", step: "income", draft: { name: "Ana" } });

    const res = await client.post("/api/v1/onboarding/complete", {
      displayName: "Ana",
      income: { avgMonthlyCents: 500000, frequency: "biweekly", days: [5, 20], createRecurring: true },
      accounts: [
        { name: "Nubank", type: "checking", initialBalanceCents: 250000 },
        { name: "Reserva", type: "investment", initialBalanceCents: 1000000 },
      ],
      cards: [{ name: "Nubank Roxinho", limitCents: 500000, closingDay: 3, dueDay: 10 }],
      fixedExpenses: [
        { description: "Aluguel", amountCents: 180000, dayOfMonth: 5, categoryKey: "moradia" },
        { description: "Internet", amountCents: 12000, dayOfMonth: 15, categoryKey: "contas" },
      ],
      goals: [{ name: "Viagem", targetAmountCents: 800000, targetDate: null }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      accountsCount: 2,
      informedBalanceCents: 1250000,
      cardsCount: 1,
      fixedExpensesMonthlyCents: 192000,
      incomeMonthlyCents: 500000,
      estimatedMonthlyLeftoverCents: 308000,
      goalsCount: 1,
      missing: [],
    });

    const recurring = (await client.get("/api/v1/recurring")).json() as { type: string; amountCents: number; amountIsEstimate: boolean }[];
    expect(recurring.filter((r) => r.type === "income").map((r) => r.amountCents)).toEqual([250000, 250000]);
    expect(recurring.filter((r) => r.type === "income").every((r) => r.amountIsEstimate)).toBe(true);
    expect(recurring.filter((r) => r.type === "expense")).toHaveLength(2);

    const summary = (await client.get("/api/v1/dashboard/summary")).json();
    expect(summary.availableBalance.cents).toBe(250000); // investimentos fora do "disponível"
    expect(summary.investments.cents).toBe(1000000);
    expect(summary.commitments.length).toBeGreaterThan(0);
    expect(summary.today).toBe(today);

    const me = (await client.get("/api/v1/me")).json();
    expect(me.profile.onboardingStatus).toBe("completed");
    expect((await client.post("/api/v1/onboarding/complete", { displayName: "Ana" })).statusCode).toBe(409);
  });

  it("pular tudo cria uma carteira e aponta o que falta", async () => {
    const { client } = await verifiedClient(ctx, "onb-min");
    const res = (await client.post("/api/v1/onboarding/complete", { displayName: "Leo" })).json();
    expect(res).toMatchObject({ accountsCount: 1, informedBalanceCents: null, estimatedMonthlyLeftoverCents: null });
    expect(res.missing).toEqual(["income", "accounts", "balances", "fixed"]);
    const accounts = (await client.get("/api/v1/accounts")).json();
    expect(accounts).toMatchObject([{ name: "Carteira", type: "wallet", balanceCents: 0 }]);
  });

  it("rejeita categoria fora da lista e rascunho grande", async () => {
    const { client } = await verifiedClient(ctx, "onb-bad");
    const bad = await client.post("/api/v1/onboarding/complete", {
      displayName: "X",
      fixedExpenses: [{ description: "x", amountCents: 1, dayOfMonth: 1, categoryKey: "salario" }],
    });
    expect(bad.statusCode).toBe(400);
    const big = await client.request({ method: "PUT", url: "/api/v1/onboarding/draft", payload: { step: "name", data: { x: "a".repeat(25000) } } });
    expect(big.statusCode).toBe(400);
  });
});
