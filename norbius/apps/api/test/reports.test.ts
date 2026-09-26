import { createDatabase, schema } from "@norbius/db";
import { addMonthsToMonth, monthOf, monthRange, todayIn } from "@norbius/domain";
import { like } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MonthlyReport } from "../src/modules/reports/reports.service";
import { createTestApp, proClient, verifiedClient, type TestClient } from "./helpers";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const owner = createDatabase(
  process.env.DATABASE_MIGRATION_URL ?? "postgres://norbius_owner:norbius_owner@localhost:5432/norbius",
  { max: 1 },
);
const today = todayIn("America/Sao_Paulo");
const prev = addMonthsToMonth(monthOf(today), -1);
const prevDay = (d: number) => `${prev}-${String(d).padStart(2, "0")}`;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await owner.db.delete(schema.users).where(like(schema.users.email, "rep-%@test.norbius"));
  await ctx.close();
  await owner.close();
});

describe("relatório mensal", () => {
  let ana: TestClient;

  beforeAll(async () => {
    ana = (await proClient(ctx, "rep-ana")).client;
    const cats = (await ana.get("/api/v1/categories")).json() as { id: string; name: string }[];
    const id = (n: string) => cats.find((c) => c.name === n)!.id;
    const acc = (await ana.post("/api/v1/accounts", { name: "Conta", type: "checking", initialBalanceCents: 100_000, initialBalanceDate: monthRange(prev).start })).json() as { id: string };
    const post = (body: object) => ana.post("/api/v1/transactions", { accountId: acc.id, ...body });
    await post({ type: "income", amountCents: 500_000, categoryId: id("Salário"), description: "Salário", date: prevDay(5) });
    await post({ type: "expense", amountCents: 180_000, categoryId: id("Moradia"), description: "Aluguel", date: prevDay(6) });
    await post({ type: "expense", amountCents: 45_000, categoryId: id("Alimentação"), description: "Mercado — mês ção", date: prevDay(10) });
    const card = (await ana.post("/api/v1/cards", { name: "Nubank", limitCents: 500_000, closingDay: 28, dueDay: 5 })).json() as { id: string };
    await ana.post("/api/v1/card-purchases", { creditCardId: card.id, description: "TV", totalAmountCents: 120_000, installmentCount: 2, purchaseDate: prevDay(2), categoryId: id("Compras") });
  });

  it("lista os meses com dados e indica o plano", async () => {
    const res = (await ana.get("/api/v1/reports/months")).json() as { months: string[]; pro: boolean };
    expect(res.pro).toBe(true);
    expect(res.months.slice(0, 2)).toEqual([monthOf(today), prev]);
  });

  it("soma receitas e despesas do mês (parcela do cartão por competência)", async () => {
    const r = (await ana.get(`/api/v1/reports/monthly?month=${prev}&format=json`)).json() as MonthlyReport;
    expect(r).toMatchObject({ month: prev, partial: false, incomeCents: 500_000 });
    // 180.000 + 45.000 + 1ª parcela da TV (60.000) se ela cai no mês anterior pela competência.
    expect([225_000, 285_000]).toContain(r.expenseCents);
    expect(r.categories[0]).toMatchObject({ name: "Moradia", cents: 180_000 });
    expect(r.topExpenses[0]).toMatchObject({ description: "Aluguel", cents: 180_000, card: false });
    expect(r.accounts).toEqual([{ name: "Conta", balanceCents: 100_000 + 500_000 - 225_000 }]);
  });

  it("gera um PDF para download", async () => {
    const res = await ana.get(`/api/v1/reports/monthly?month=${prev}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="norbius-${prev}.pdf"`);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(res.rawPayload.length).toBeGreaterThan(2_000);
    // Relatório curto cabe numa página (o rodapé não pode abrir páginas em branco).
    expect(res.rawPayload.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
    if (process.env.REPORT_PDF_OUT) writeFileSync(process.env.REPORT_PDF_OUT, res.rawPayload);
  });

  it("valida o mês", async () => {
    expect((await ana.get("/api/v1/reports/monthly?month=2026-13")).statusCode).toBe(400);
    expect((await ana.get(`/api/v1/reports/monthly?month=${addMonthsToMonth(monthOf(today), 1)}`)).statusCode).toBe(400);
  });
});

describe("plano Grátis", () => {
  it("não gera relatório completo", async () => {
    const { client } = await verifiedClient(ctx, "rep-free");
    const res = await client.get(`/api/v1/reports/monthly?month=${prev}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PLAN_REQUIRED");
    expect(((await client.get("/api/v1/reports/months")).json() as { pro: boolean }).pro).toBe(false);
  });
});
