import { createDatabase, schema } from "@norbius/db";
import { addDays, addMonths, invoiceForPurchase, monthOf, todayIn } from "@norbius/domain";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, verifiedClient, type TestClient } from "./helpers";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let ana: TestClient;
let bia: TestClient;
const owner = createDatabase(
  process.env.DATABASE_MIGRATION_URL ?? "postgres://norbius_owner:norbius_owner@localhost:5432/norbius",
  { max: 1 },
);
const today = todayIn("America/Sao_Paulo");
let food: string, salary: string, housing: string;

beforeAll(async () => {
  ctx = await createTestApp();
  ana = (await verifiedClient(ctx, "fin-ana")).client;
  bia = (await verifiedClient(ctx, "fin-bia")).client;
  const cats = (await ana.get("/api/v1/categories")).json() as { id: string; name: string; kind: string }[];
  food = cats.find((c) => c.name === "Alimentação")!.id;
  housing = cats.find((c) => c.name === "Moradia")!.id;
  salary = cats.find((c) => c.name === "Salário")!.id;
});

afterAll(async () => {
  await owner.db.delete(schema.users).where(like(schema.users.email, "fin-%@test.norbius"));
  await ctx.close();
  await owner.close();
});

async function account(client: TestClient, name: string, initialBalanceCents = 0, extra: Record<string, unknown> = {}) {
  const res = await client.post("/api/v1/accounts", { name, type: "checking", initialBalanceCents, ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; balanceCents: number };
}

async function balance(client: TestClient, id: string) {
  const list = (await client.get("/api/v1/accounts?archived=true")).json() as { id: string; balanceCents: number }[];
  return list.find((a) => a.id === id)!.balanceCents;
}

const expense = (accountId: string, amountCents: number, date = today, description = "Mercado") => ({
  type: "expense",
  accountId,
  amountCents,
  categoryId: food,
  description,
  date,
});

describe("categorias", () => {
  it("lista as categorias do sistema e cria personalizadas", async () => {
    const cats = (await ana.get("/api/v1/categories")).json() as { system: boolean }[];
    expect(cats.filter((c) => c.system)).toHaveLength(14);
    const res = await ana.post("/api/v1/categories", { name: "Pets", kind: "expense" });
    expect(res.statusCode).toBe(201);
    expect((await bia.get("/api/v1/categories")).json().some((c: { name: string }) => c.name === "Pets")).toBe(false);
  });
});

describe("contas e saldos", () => {
  it("saldo = inicial + movimentações até hoje", async () => {
    const acc = await account(ana, "Corrente", 100000);
    expect(acc.balanceCents).toBe(100000);
    await ana.post("/api/v1/transactions", expense(acc.id, 5000));
    await ana.post("/api/v1/transactions", { type: "income", accountId: acc.id, amountCents: 20000, categoryId: salary, description: "Freela", date: today });
    expect(await balance(ana, acc.id)).toBe(115000);
  });

  it("lançamento futuro não afeta o saldo atual; anterior ao saldo inicial também não", async () => {
    const acc = await account(ana, "Futuro", 50000);
    await ana.post("/api/v1/transactions", expense(acc.id, 1000, addDays(today, 5)));
    await ana.post("/api/v1/transactions", expense(acc.id, 2000, addDays(today, -5)));
    expect(await balance(ana, acc.id)).toBe(50000);
  });

  it("transferência move saldo entre contas sem ser receita/despesa", async () => {
    const a = await account(ana, "Origem", 10000);
    const b = await account(ana, "Destino", 0);
    const res = await ana.post("/api/v1/transactions", { type: "transfer", accountId: a.id, transferAccountId: b.id, amountCents: 4000, date: today });
    expect(res.statusCode).toBe(201);
    expect(res.json().description).toBe("Transferência para Destino");
    expect(await balance(ana, a.id)).toBe(6000);
    expect(await balance(ana, b.id)).toBe(4000);
  });

  it("rejeita transferência para a mesma conta", async () => {
    const a = await account(ana, "Única");
    const res = await ana.post("/api/v1/transactions", { type: "transfer", accountId: a.id, transferAccountId: a.id, amountCents: 1, date: today });
    expect(res.statusCode).toBe(400);
  });

  it("arquiva conta e impede novos lançamentos nela", async () => {
    const a = await account(ana, "Antiga");
    expect((await ana.post(`/api/v1/accounts/${a.id}/archive`)).json().archived).toBe(true);
    expect((await ana.post("/api/v1/transactions", expense(a.id, 100))).json().error.code).toBe("INVALID_ACCOUNT");
  });
});

describe("transações", () => {
  let acc: string;
  beforeAll(async () => {
    acc = (await account(ana, "Lista")).id;
    for (const [amount, desc, daysAgo] of [
      [1500, "Padaria", 1],
      [9000, "Supermercado Pão", 2],
      [300, "Café", 3],
    ] as const) {
      await ana.post("/api/v1/transactions", expense(acc, amount, addDays(today, -daysAgo), desc));
    }
  });

  it("valida categoria incompatível com o tipo", async () => {
    const res = await ana.post("/api/v1/transactions", { ...expense(acc, 100), categoryId: salary });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_CATEGORY");
  });

  it("valida campos com mensagens por campo", async () => {
    const res = await ana.post("/api/v1/transactions", { ...expense(acc, 0), description: "" });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields)).toEqual(expect.arrayContaining(["amountCents", "description"]));
  });

  it("filtra por conta, busca, ordena e pagina", async () => {
    const q = (s: string) => ana.get(`/api/v1/transactions?accountId=${acc}&${s}`).then((r) => r.json());
    expect((await q("q=p%C3%A3o")).items.map((i: { description: string }) => i.description)).toEqual(["Supermercado Pão"]);
    expect((await q("sort=amount_asc")).items.map((i: { amountCents: number }) => i.amountCents)).toEqual([300, 1500, 9000]);
    const page = await q("pageSize=2&page=2");
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
    expect(page.totals.expenseCents).toBe(10800);
  });

  it("busca trata % e _ como texto", async () => {
    expect((await ana.get(`/api/v1/transactions?accountId=${acc}&q=%25`)).json().total).toBe(0);
  });

  it("excluir e desfazer", async () => {
    const created = (await ana.post("/api/v1/transactions", expense(acc, 777))).json();
    expect((await ana.request({ method: "DELETE", url: `/api/v1/transactions/${created.id}` })).statusCode).toBe(204);
    expect((await ana.get(`/api/v1/transactions/${created.id}`)).statusCode).toBe(404);
    expect((await ana.post(`/api/v1/transactions/${created.id}/restore`)).json().amountCents).toBe(777);
  });

  it("edita uma transação", async () => {
    const created = (await ana.post("/api/v1/transactions", expense(acc, 1000))).json();
    const res = await ana.request({ method: "PUT", url: `/api/v1/transactions/${created.id}`, payload: expense(acc, 1250, today, "Feira") });
    expect(res.json()).toMatchObject({ amountCents: 1250, description: "Feira" });
  });

  it("exporta CSV em pt-BR e neutraliza fórmulas", async () => {
    await ana.post("/api/v1/transactions", expense(acc, 4200, today, '=HYPERLINK("http://x")'));
    const res = await ana.get(`/api/v1/transactions/export.csv?accountId=${acc}`);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body.startsWith("﻿\"Data\";\"Tipo\"")).toBe(true);
    expect(res.body).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(res.body).toContain('"-42,00"');
  });
});

describe("cartões e faturas", () => {
  let card: { id: string };
  let payFrom: string;
  beforeAll(async () => {
    payFrom = (await account(ana, "Pagadora", 500000)).id;
    card = (await ana.post("/api/v1/cards", { name: "Nubank", limitCents: 300000, closingDay: 3, dueDay: 10 })).json();
  });

  it("compra parcelada ocupa o limite e cai em faturas consecutivas", async () => {
    const res = await ana.post("/api/v1/card-purchases", {
      creditCardId: card.id,
      description: "Notebook",
      totalAmountCents: 120000,
      installmentCount: 3,
      purchaseDate: today,
      categoryId: food,
    });
    expect(res.statusCode, res.body).toBe(201);
    const c = (await ana.get(`/api/v1/cards/${card.id}`)).json();
    expect(c.usedLimitCents).toBe(120000);
    expect(c.availableLimitCents).toBe(180000);
    const invoices = (await ana.get(`/api/v1/cards/${card.id}/invoices`)).json() as { referenceMonth: string; totalCents: number }[];
    const first = invoiceForPurchase(today, { closingDay: 3, dueDay: 10 }).referenceMonth;
    expect(invoices.map((i) => i.referenceMonth).sort()).toEqual([
      first,
      monthOf(addMonths(`${first}-01`, 1)),
      monthOf(addMonths(`${first}-01`, 2)),
    ]);
    expect(invoices.every((i) => i.totalCents === 40000)).toBe(true);
  });

  it("pagamento parcial reduz a conta, libera limite e não conta como despesa", async () => {
    const invoices = (await ana.get(`/api/v1/cards/${card.id}/invoices`)).json() as { id: string; referenceMonth: string }[];
    const target = invoices.sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth))[0]!;
    const before = (await ana.get("/api/v1/dashboard/summary")).json().monthExpense.cents;
    const res = await ana.post(`/api/v1/invoices/${target.id}/payments`, { accountId: payFrom, amountCents: 15000, date: today });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().invoice.paidCents).toBe(15000);
    expect(await balance(ana, payFrom)).toBe(485000);
    expect((await ana.get(`/api/v1/cards/${card.id}`)).json().usedLimitCents).toBe(105000);
    expect((await ana.get("/api/v1/dashboard/summary")).json().monthExpense.cents).toBe(before);
  });

  it("não aceita pagar mais que o saldo da fatura", async () => {
    const [inv] = (await ana.get(`/api/v1/cards/${card.id}/invoices`)).json() as { id: string }[];
    const res = await ana.post(`/api/v1/invoices/${inv!.id}/payments`, { accountId: payFrom, amountCents: 999999, date: today });
    expect(res.json().error.code).toBe("AMOUNT_EXCEEDS_INVOICE");
  });

  it("editar a compra recalcula as parcelas; excluir libera o limite", async () => {
    const created = (
      await ana.post("/api/v1/card-purchases", { creditCardId: card.id, description: "Fone", totalAmountCents: 10000, installmentCount: 1, purchaseDate: today, categoryId: food })
    ).json();
    const used = (await ana.get(`/api/v1/cards/${card.id}`)).json().usedLimitCents;
    await ana.request({
      method: "PUT",
      url: `/api/v1/card-purchases/${created.id}`,
      payload: { creditCardId: card.id, description: "Fone", totalAmountCents: 10001, installmentCount: 2, purchaseDate: today, categoryId: food },
    });
    expect((await ana.get(`/api/v1/cards/${card.id}`)).json().usedLimitCents).toBe(used + 1);
    await ana.request({ method: "DELETE", url: `/api/v1/card-purchases/${created.id}` });
    expect((await ana.get(`/api/v1/cards/${card.id}`)).json().usedLimitCents).toBe(used - 10000);
  });
});

describe("recorrências", () => {
  it("registra a ocorrência pendente e avança para a próxima", async () => {
    const acc = (await account(ana, "Contas fixas", 300000)).id;
    const day = Number(today.slice(8, 10));
    const rec = (
      await ana.post("/api/v1/recurring", {
        type: "expense",
        accountId: acc,
        amountCents: 180000,
        categoryId: housing,
        description: "Aluguel",
        frequency: "monthly",
        dayOfMonth: day,
        startDate: today,
      })
    ).json();
    expect(rec.nextDate).toBe(today);
    expect((await ana.post(`/api/v1/recurring/${rec.id}/confirm`, { date: addDays(today, 1) })).statusCode).toBe(400);
    const done = (await ana.post(`/api/v1/recurring/${rec.id}/confirm`, { date: today, amountCents: 175000 })).json();
    expect(done.created.kind).toBe("transaction");
    expect(done.recurring.nextDate).toBe(addMonths(today, 1, day));
    expect(await balance(ana, acc)).toBe(125000);
    const skipped = (await ana.post(`/api/v1/recurring/${rec.id}/skip`, { date: done.recurring.nextDate })).json();
    expect(skipped.nextDate).toBe(addMonths(today, 2, day));
  });

  it("recusa receita no cartão", async () => {
    const card = (await ana.post("/api/v1/cards", { name: "X", limitCents: 1000, closingDay: 1, dueDay: 8 })).json();
    const res = await ana.post("/api/v1/recurring", {
      type: "income", creditCardId: card.id, amountCents: 100, categoryId: salary, description: "x", frequency: "monthly", startDate: today,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("metas", () => {
  it("aportes atualizam progresso e status", async () => {
    const goal = (await ana.post("/api/v1/goals", { name: "Reserva", targetAmountCents: 10000, targetDate: addMonths(today, 10) })).json();
    expect(goal.monthlyNeededCents).toBeGreaterThanOrEqual(1000);
    const after = (await ana.post(`/api/v1/goals/${goal.id}/contributions`, { amountCents: 10000, date: today })).json();
    expect(after).toMatchObject({ status: "completed", progress: 1, monthlyNeededCents: null });
    const withdrawn = (await ana.post(`/api/v1/goals/${goal.id}/contributions`, { amountCents: -2500, date: today })).json();
    expect(withdrawn).toMatchObject({ status: "active", currentAmountCents: 7500 });
    expect((await ana.get(`/api/v1/goals/${goal.id}/contributions`)).json()).toHaveLength(2);
  });
});

describe("isolamento entre usuários", () => {
  let accA: string, txA: string, cardA: string, goalA: string, invoiceA: string, recA: string, catA: string;
  beforeAll(async () => {
    accA = (await account(ana, "Privada", 1000)).id;
    txA = (await ana.post("/api/v1/transactions", expense(accA, 100))).json().id;
    cardA = (await ana.post("/api/v1/cards", { name: "Privado", limitCents: 1000, closingDay: 5, dueDay: 12 })).json().id;
    await ana.post("/api/v1/card-purchases", { creditCardId: cardA, description: "x", totalAmountCents: 100, purchaseDate: today, categoryId: food });
    invoiceA = (await ana.get(`/api/v1/cards/${cardA}/invoices`)).json()[0].id;
    goalA = (await ana.post("/api/v1/goals", { name: "Privada", targetAmountCents: 100 })).json().id;
    recA = (await ana.post("/api/v1/recurring", { type: "expense", accountId: accA, amountCents: 1, categoryId: food, description: "x", frequency: "monthly", startDate: today })).json().id;
    catA = (await ana.post("/api/v1/categories", { name: "Secreta", kind: "expense" })).json().id;
  });

  it("B não lê nada de A", async () => {
    expect((await bia.get(`/api/v1/transactions/${txA}`)).statusCode).toBe(404);
    expect((await bia.get(`/api/v1/cards/${cardA}`)).statusCode).toBe(404);
    expect((await bia.get(`/api/v1/invoices/${invoiceA}`)).statusCode).toBe(404);
    expect((await bia.get(`/api/v1/goals/${goalA}/contributions`)).statusCode).toBe(404);
    expect((await bia.get("/api/v1/accounts")).json()).toHaveLength(0);
    expect((await bia.get("/api/v1/transactions")).json().total).toBe(0);
    expect((await bia.get("/api/v1/recurring")).json()).toHaveLength(0);
  });

  it("B não altera nem exclui dados de A", async () => {
    const accB = (await account(bia, "B")).id;
    expect((await bia.request({ method: "PUT", url: `/api/v1/transactions/${txA}`, payload: expense(accB, 1) })).statusCode).toBe(404);
    expect((await bia.request({ method: "DELETE", url: `/api/v1/transactions/${txA}` })).statusCode).toBe(404);
    expect((await bia.request({ method: "PUT", url: `/api/v1/accounts/${accA}`, payload: { name: "x", type: "checking" } })).statusCode).toBe(404);
    expect((await bia.post(`/api/v1/accounts/${accA}/archive`)).statusCode).toBe(404);
    expect((await bia.post(`/api/v1/goals/${goalA}/contributions`, { amountCents: 1, date: today })).statusCode).toBe(404);
    expect((await bia.post(`/api/v1/recurring/${recA}/deactivate`)).statusCode).toBe(404);
    expect((await ana.get(`/api/v1/transactions/${txA}`)).statusCode).toBe(200);
  });

  it("B não usa conta, cartão, fatura ou categoria de A", async () => {
    const accB = (await account(bia, "B2", 100000)).id;
    expect((await bia.post("/api/v1/transactions", expense(accA, 1))).json().error.code).toBe("INVALID_ACCOUNT");
    expect((await bia.post("/api/v1/transactions", { type: "transfer", accountId: accB, transferAccountId: accA, amountCents: 1, date: today })).json().error.code).toBe("INVALID_ACCOUNT");
    expect((await bia.post("/api/v1/transactions", { ...expense(accB, 1), categoryId: catA })).json().error.code).toBe("INVALID_CATEGORY");
    expect((await bia.post("/api/v1/card-purchases", { creditCardId: cardA, description: "x", totalAmountCents: 1, purchaseDate: today, categoryId: food })).json().error.code).toBe("INVALID_CARD");
    expect((await bia.post(`/api/v1/invoices/${invoiceA}/payments`, { accountId: accB, amountCents: 1, date: today })).statusCode).toBe(404);
    expect((await bia.post("/api/v1/cards", { name: "x", limitCents: 1, closingDay: 1, dueDay: 2, defaultPaymentAccountId: accA })).json().error.code).toBe("INVALID_ACCOUNT");
  });
});

describe("rotas exigem sessão", () => {
  it.each(["/api/v1/accounts", "/api/v1/transactions", "/api/v1/cards", "/api/v1/goals", "/api/v1/recurring", "/api/v1/dashboard/summary", "/api/v1/onboarding"])(
    "%s → 401",
    async (url) => {
      const res = await ctx.app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    },
  );
});

describe("csvCell", () => {
  it("neutraliza fórmulas mas preserva números negativos", async () => {
    const { csvCell } = await import("../src/modules/transactions/csv");
    expect(csvCell("-42,00")).toBe('"-42,00"');
    expect(csvCell("-1+1")).toBe(`"'-1+1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
  });
});
