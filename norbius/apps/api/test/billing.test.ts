import { createLogger } from "@norbius/observability";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AsaasProvider } from "../src/modules/billing/asaas";
import { FakeBillingProvider } from "../src/modules/billing/fake";
import { BillingRejectedError } from "../src/modules/billing/provider";
import { parseAsaasEvent } from "../src/modules/billing/webhook";
import { APP_URL, createTestApp, TestClient, verifiedClient } from "./helpers";

const TOKEN = "webhook-token-with-at-least-32-characters";
const CPF = "529.982.247-25";
const fake = new FakeBillingProvider(APP_URL);
let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp({ ASAAS_WEBHOOK_TOKEN: TOKEN }, { billingProvider: fake });
});
afterAll(() => ctx.close());

function webhook(body: unknown, token = TOKEN) {
  return ctx.app.inject({ method: "POST", url: "/api/v1/billing/webhooks/asaas", headers: { "asaas-access-token": token }, payload: body as object });
}

/** Evento no formato do Asaas para a primeira cobrança da assinatura do usuário. */
async function paymentEvent(client: TestClient, event: string, status: string, overrides: Record<string, unknown> = {}) {
  const latest = (await client.get("/api/v1/billing")).json().payments[0];
  const sub = [...fake.payments.values()].find((x) => x.invoiceUrl === latest?.invoiceUrl)!;
  return {
    id: `evt_${crypto.randomUUID()}`,
    event,
    payment: {
      object: "payment",
      id: sub.id,
      customer: sub.customerId,
      subscription: sub.subscriptionId,
      value: sub.amountCents / 100,
      netValue: 13.5,
      billingType: "PIX",
      status,
      dueDate: sub.dueDate,
      invoiceUrl: sub.invoiceUrl,
      ...overrides,
    },
  };
}

async function subscribed(tag: string, cycle: "monthly" | "yearly" = "monthly") {
  const { client } = await verifiedClient(ctx, tag);
  const res = await client.post("/api/v1/billing/checkout", { cycle, cpfCnpj: CPF });
  expect(res.statusCode).toBe(200);
  return { client, invoiceUrl: res.json().invoiceUrl as string };
}

describe("plano grátis e teste", () => {
  it("conta nova é grátis, com teste disponível e preços do Pro", async () => {
    const { client } = await verifiedClient(ctx, "bill-new");
    expect((await client.get("/api/v1/billing")).json()).toMatchObject({
      plan: "free",
      status: "none",
      trialAvailable: true,
      checkoutAvailable: true,
      prices: { monthly: 1490, yearly: 14900 },
      limits: { assistant: false, maxActiveGoals: 3 },
    });
  });

  it("teste grátis libera o Pro por 7 dias e só pode ser usado uma vez", async () => {
    const { client } = await verifiedClient(ctx, "bill-trial");
    const res = await client.post("/api/v1/billing/trial");
    expect(res.json()).toMatchObject({ plan: "pro", reason: "trial", trialAvailable: false, limits: { assistant: true, maxActiveGoals: null } });
    const again = await client.post("/api/v1/billing/trial");
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("TRIAL_USED");
  });

  it("plano grátis limita metas ativas; arquivar libera espaço; Pro não tem limite", async () => {
    const { client } = await verifiedClient(ctx, "bill-goals");
    const ids: string[] = [];
    for (const n of [1, 2, 3]) ids.push((await client.post("/api/v1/goals", { name: `Meta ${n}`, targetAmountCents: 10000 })).json().id);
    const fourth = await client.post("/api/v1/goals", { name: "Meta 4", targetAmountCents: 10000 });
    expect(fourth.statusCode).toBe(403);
    expect(fourth.json().error.code).toBe("PLAN_LIMIT");

    await client.post(`/api/v1/goals/${ids[0]}/archive`);
    expect((await client.post("/api/v1/goals", { name: "Meta 4", targetAmountCents: 10000 })).statusCode).toBe(201);
    expect((await client.post(`/api/v1/goals/${ids[0]}/unarchive`)).statusCode).toBe(403);

    await client.post("/api/v1/billing/trial");
    expect((await client.post(`/api/v1/goals/${ids[0]}/unarchive`)).statusCode).toBe(200);
    expect((await client.post("/api/v1/goals", { name: "Meta 5", targetAmountCents: 10000 })).statusCode).toBe(201);
  });
});

describe("assinatura", () => {
  it("recusa CPF inválido sem falar com o provedor", async () => {
    const { client } = await verifiedClient(ctx, "bill-cpf");
    const before = fake.customers;
    const res = await client.post("/api/v1/billing/checkout", { cycle: "monthly", cpfCnpj: "111.111.111-11" });
    expect(res.statusCode).toBe(400);
    expect(fake.customers).toBe(before);
  });

  it("checkout gera a cobrança pendente; o acesso só vem com o pagamento confirmado", async () => {
    const { client, invoiceUrl } = await subscribed("bill-pay");
    expect(invoiceUrl).toContain("/configuracoes/plano?cobranca=");
    let o = (await client.get("/api/v1/billing")).json();
    expect(o).toMatchObject({ plan: "free", status: "pending", cycle: "monthly", openPayment: { amountCents: 1490, status: "pending", invoiceUrl } });

    // Clicar de novo reaproveita a mesma cobrança (sem assinatura duplicada).
    const size = fake.payments.size;
    expect((await client.post("/api/v1/billing/checkout", { cycle: "monthly", cpfCnpj: CPF })).json().invoiceUrl).toBe(invoiceUrl);
    expect(fake.payments.size).toBe(size);

    const evt = await paymentEvent(client, "PAYMENT_RECEIVED", "RECEIVED");
    expect((await webhook(evt)).json()).toEqual({ received: true, outcome: "paid" });
    o = (await client.get("/api/v1/billing")).json();
    expect(o).toMatchObject({ plan: "pro", reason: "paid", status: "active", openPayment: null, limits: { assistant: true } });
    expect(o.payments[0]).toMatchObject({ status: "paid", billingType: "PIX" });

    // Reenvio do mesmo evento não reprocessa; evento antigo fora de ordem não "despaga".
    expect((await webhook(evt)).json().outcome).toBe("duplicate");
    await webhook(await paymentEvent(client, "PAYMENT_CREATED", "PENDING"));
    expect((await client.get("/api/v1/billing")).json().payments[0].status).toBe("paid");

    const again = await client.post("/api/v1/billing/checkout", { cycle: "yearly", cpfCnpj: CPF });
    expect(again.statusCode).toBe(409);
  });

  it("cobrança vencida mantém o Pro na carência; cancelar mantém até o fim do período", async () => {
    const { client } = await subscribed("bill-cancel");
    await webhook(await paymentEvent(client, "PAYMENT_CONFIRMED", "CONFIRMED"));
    const paid = (await client.get("/api/v1/billing")).json();
    expect(paid.plan).toBe("pro");

    const res = await client.post("/api/v1/billing/cancel");
    expect(res.json()).toMatchObject({ plan: "pro", status: "canceled", cancelAtPeriodEnd: true, proUntil: paid.proUntil });
    expect(fake.canceled.size).toBeGreaterThan(0);
    expect((await client.post("/api/v1/billing/cancel")).statusCode).toBe(409);
  });

  it("vencimento sem pagamento: past_due", async () => {
    const { client } = await subscribed("bill-overdue");
    expect((await webhook(await paymentEvent(client, "PAYMENT_OVERDUE", "OVERDUE"))).json().outcome).toBe("past_due");
    // Sem pagamento anterior não há carência: continua grátis, com o link para pagar.
    expect((await client.get("/api/v1/billing")).json()).toMatchObject({ plan: "free", status: "past_due", openPayment: { status: "overdue" } });
  });
});

describe("webhook", () => {
  it("exige o token e ignora eventos irrelevantes ou de clientes desconhecidos", async () => {
    expect((await webhook({ id: "evt_x", event: "PAYMENT_RECEIVED" }, "token-errado")).statusCode).toBe(401);
    expect((await webhook({ nada: true })).statusCode).toBe(400);
    expect((await webhook({ id: `evt_${crypto.randomUUID()}`, event: "TRANSFER_CREATED" })).json().outcome).toBe("ignored");
    const unknown = await webhook({
      id: `evt_${crypto.randomUUID()}`,
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_x", customer: "cus_desconhecido", value: 14.9, status: "RECEIVED", dueDate: "2026-09-26" },
    });
    expect(unknown.json().outcome).toBe("unknown_customer");
  });

  it("pagamento de um usuário nunca afeta outro", async () => {
    const a = await subscribed("bill-iso-a");
    const b = await subscribed("bill-iso-b");
    await webhook(await paymentEvent(a.client, "PAYMENT_RECEIVED", "RECEIVED"));
    expect((await a.client.get("/api/v1/billing")).json().plan).toBe("pro");
    expect((await b.client.get("/api/v1/billing")).json().plan).toBe("free");
  });

  it("sem provedor configurado: checkout indisponível, teste grátis funciona", async () => {
    const off = await createTestApp();
    try {
      const { client } = await verifiedClient(off, "bill-off");
      expect((await client.get("/api/v1/billing")).json().checkoutAvailable).toBe(false);
      const res = await client.post("/api/v1/billing/checkout", { cycle: "monthly", cpfCnpj: CPF });
      expect(res.statusCode).toBe(503);
      expect((await client.post("/api/v1/billing/trial")).json().plan).toBe("pro");
      expect((await off.app.inject({ method: "POST", url: "/api/v1/billing/webhooks/asaas", payload: {} })).statusCode).toBe(503);
    } finally {
      await off.close();
    }
  });
});

describe("Asaas", () => {
  afterEach(() => vi.unstubAllGlobals());
  const log = createLogger({ service: "test", level: "silent" });

  it("converte o evento do Asaas (reais → centavos, status)", () => {
    const e = parseAsaasEvent({
      id: "evt_1",
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_1", customer: "cus_1", subscription: "sub_1", value: 149, status: "CONFIRMED", billingType: "CREDIT_CARD", dueDate: "2026-09-26", invoiceUrl: "https://www.asaas.com/i/1" },
    });
    expect(e).toMatchObject({ kind: "payment", payment: { amountCents: 14900, status: "paid", subscriptionId: "sub_1", dueDate: "2026-09-26" } });
    expect(parseAsaasEvent({ id: "evt_2", event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_1", customer: "cus_1" } })).toMatchObject({ kind: "subscription_ended" });
  });

  it("cria assinatura com o formato da API v3 e trata recusas", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/customers")) return new Response(JSON.stringify({ errors: [{ code: "invalid_cpfCnpj", description: "O CPF informado é inválido." }] }), { status: 400 });
      return new Response(JSON.stringify({ id: "sub_1" }), { status: 200 });
    });
    const asaas = new AsaasProvider("chave", "sandbox", log);
    await asaas.createSubscription({ customerId: "cus_1", cycle: "yearly", amountCents: 14900, nextDueDate: "2026-09-26", description: "NORBIUS Pro — anual", externalReference: "u1" });
    expect(calls[0]!.url).toBe("https://sandbox.asaas.com/api/v3/subscriptions");
    expect((calls[0]!.init.headers as Record<string, string>).access_token).toBe("chave");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ customer: "cus_1", billingType: "UNDEFINED", value: 149, cycle: "YEARLY", nextDueDate: "2026-09-26" });
    await expect(asaas.createCustomer({ name: "A", email: "a@b.c", cpfCnpj: "1", externalReference: "u1" })).rejects.toThrow(BillingRejectedError);
  });
});
