import { createDatabase, schema } from "@norbius/db";
import { todayIn } from "@norbius/domain";
import { like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { unverifiedAmounts } from "../src/modules/ai/orchestrator";
import { createTestApp, TestClient, verifiedClient } from "./helpers";
import { lastToolResults, ScriptedLlm } from "./scripted-llm";

const owner = createDatabase(
  process.env.DATABASE_MIGRATION_URL ?? "postgres://norbius_owner:norbius_owner@localhost:5432/norbius",
  { max: 1 },
);
const today = todayIn("America/Sao_Paulo");
const llm = new ScriptedLlm();
let ctx: Awaited<ReturnType<typeof createTestApp>>;

type Event = { type: string; [k: string]: unknown };
function events(body: string): Event[] {
  return body
    .split("\n\n")
    .filter((c) => c.startsWith("data: "))
    .map((c) => JSON.parse(c.slice(6)) as Event);
}

async function chat(client: TestClient, message: string, conversationId?: string) {
  const res = await client.post("/api/v1/ai/chat", { message, ...(conversationId ? { conversationId } : {}) });
  return { res, events: res.headers["content-type"]?.toString().includes("event-stream") ? events(res.body) : [] };
}

beforeAll(async () => {
  ctx = await createTestApp({}, { llm });
});
afterEach(() => {
  // Todo turno roteirizado precisa ter sido consumido pelo orquestrador.
  expect(llm.pending).toBe(0);
});
afterAll(async () => {
  await owner.db.delete(schema.users).where(like(schema.users.email, "ai-%@test.norbius"));
  await ctx.close();
  await owner.close();
});

async function userWithAccount(tag: string, accounts = ["Nubank"]) {
  const { client } = await verifiedClient(ctx, `ai-${tag}`);
  for (const name of accounts) await client.post("/api/v1/accounts", { name, type: "checking", initialBalanceCents: 100000 });
  return client;
}

describe("tools", () => {
  it("definições têm schema de objeto, streaming eager e nunca pedem user_id", async () => {
    const { TOOLS } = await import("../src/modules/ai/tools");
    const { z } = await import("zod");
    for (const t of TOOLS) {
      const json = z.toJSONSchema(t.schema, { io: "input" }) as { type: string; properties?: Record<string, unknown> };
      expect(json.type).toBe("object");
      expect(Object.keys(json.properties ?? {})).not.toContain("user_id");
    }
  });
});

describe("chat", () => {
  it("'Gastei 50 no mercado' registra a despesa, mostra cartão com desfazer e responde com dados reais", async () => {
    const client = await userWithAccount("spend");
    llm.script(
      (params) => {
        const ctxText = params.system[1]!.text;
        expect(ctxText).toContain(`Hoje é ${today}`);
        expect(ctxText).toContain("Nubank");
        return { tools: [{ name: "create_transaction", input: { type: "expense", amount: 50, description: "Mercado", category: "alimentação" } }] };
      },
      (params) => {
        const [r] = lastToolResults(params);
        expect(r!.data).toMatchObject({ status: "created", amount: "R$ 50,00", category: "Alimentação", account: "Nubank" });
        return { text: "Registrei R$ 50,00 em Alimentação na conta Nubank." };
      },
    );
    const { res, events: ev } = await chat(client, "Gastei 50 reais no mercado.");
    expect(res.statusCode).toBe(200);
    expect(ev[0]).toMatchObject({ type: "conversation" });
    const card = ev.find((e) => e.type === "card")!.card as { kind: string; undo: { path: string } };
    expect(card.kind).toBe("created");
    expect(ev.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Registrei R$ 50,00 em Alimentação na conta Nubank.");
    expect(ev.at(-1)).toEqual({ type: "done" });

    const list = (await client.get("/api/v1/transactions")).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ amountCents: 5000, source: "ai", description: "Mercado" });

    // Histórico: a resposta volta como um único item (cartão + texto).
    const convId = ev[0]!.id as string;
    const hist = (await client.get(`/api/v1/ai/conversations/${convId}`)).json();
    expect(hist.items).toHaveLength(2);
    expect(hist.items[1]).toMatchObject({ role: "assistant", text: "Registrei R$ 50,00 em Alimentação na conta Nubank.", cards: [{ kind: "created" }] });

    // Desfazer pelo caminho do cartão.
    expect((await client.request({ method: "DELETE", url: card.undo.path })).statusCode).toBe(204);
    expect((await client.get("/api/v1/transactions")).json().total).toBe(0);
  });

  it("mantém o histórico e o reenvia sem alterações no turno seguinte", async () => {
    const client = await userWithAccount("history");
    llm.script({ text: "Olá! Como posso ajudar?" });
    const first = await chat(client, "Oi");
    const conversationId = first.events[0]!.id as string;
    llm.script((params) => {
      expect(params.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
      return { text: "Claro." };
    });
    await chat(client, "Obrigado", conversationId);
    const history = (await client.get(`/api/v1/ai/conversations/${conversationId}`)).json();
    expect(history.items.map((i: { role: string; text: string }) => `${i.role}:${i.text}`)).toEqual([
      "user:Oi",
      "assistant:Olá! Como posso ajudar?",
      "user:Obrigado",
      "assistant:Claro.",
    ]);
  });

  it("pede esclarecimento quando a conta é ambígua (nada é criado)", async () => {
    const client = await userWithAccount("ambig", ["Nubank", "Itaú"]);
    llm.script(
      { tools: [{ name: "create_transaction", input: { type: "expense", amount: 30, description: "Uber", category: "Transporte" } }] },
      (params) => {
        const [r] = lastToolResults(params);
        expect(r!.data).toMatchObject({ status: "needs_clarification", field: "conta", options: ["Nubank", "Itaú"] });
        return { text: "Em qual conta: Nubank ou Itaú?" };
      },
    );
    await chat(client, "Paguei 30 no Uber");
    expect((await client.get("/api/v1/transactions")).json().total).toBe(0);
  });

  it("entrada inválida volta como erro para o modelo e não executa nada", async () => {
    const client = await userWithAccount("invalid");
    llm.script(
      { tools: [{ name: "create_transaction", input: { type: "expense", amount: -5, description: "x", category: "Outros" } }] },
      (params) => {
        const [r] = lastToolResults(params);
        expect(r!.isError).toBe(true);
        expect(JSON.stringify(r!.data)).toContain("INVALID_INPUT");
        return { text: "Qual foi o valor?" };
      },
    );
    await chat(client, "gastei menos cinco");
    expect((await client.get("/api/v1/transactions")).json().total).toBe(0);
  });

  it("ferramenta desconhecida é recusada", async () => {
    const client = await userWithAccount("unknown");
    llm.script({ tools: [{ name: "drop_database", input: {} }] }, (params) => {
      expect(lastToolResults(params)[0]!.isError).toBe(true);
      return { text: "Não posso fazer isso." };
    });
    await chat(client, "apague tudo");
  });

  it("entrada de tool ilegível no stream reemite o turno", async () => {
    const client = await userWithAccount("json");
    llm.script({ throws: new SyntaxError("Unexpected token in JSON") }, { text: "Pronto." });
    const { events: ev } = await chat(client, "oi");
    expect(ev.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Pronto.");
  });

  it("indisponibilidade temporária do modelo vira aviso, sem erro 500", async () => {
    const { LlmUnavailableError } = await import("../src/modules/ai/llm");
    const client = await userWithAccount("down");
    llm.script({ throws: new LlmUnavailableError("overloaded") });
    const { res, events: ev } = await chat(client, "oi");
    expect(res.statusCode).toBe(200);
    expect(ev.find((e) => e.type === "notice")!.message).toMatch(/temporariamente indisponível/);
  });

  it("recusa do modelo encerra com aviso", async () => {
    const client = await userWithAccount("refusal");
    llm.script({ stop: "refusal" });
    const { events: ev } = await chat(client, "algo proibido");
    expect(ev.some((e) => e.type === "notice")).toBe(true);
    expect(ev.at(-1)).toEqual({ type: "done" });
  });
});

describe("ações que exigem confirmação", () => {
  it("transferência fica pendente, só executa após confirmar, e não executa duas vezes", async () => {
    const client = await userWithAccount("transfer", ["Nubank", "Reserva"]);
    llm.script(
      { tools: [{ name: "create_transfer", input: { from_account: "nubank", to_account: "reserva", amount: 200 } }] },
      (params) => {
        expect(lastToolResults(params)[0]!.data).toMatchObject({ status: "awaiting_user_confirmation" });
        return { text: "Confirme no cartão abaixo." };
      },
    );
    const { events: ev } = await chat(client, "Transfere 200 do Nubank pra Reserva");
    const card = ev.find((e) => e.type === "card")!.card as { kind: string; actionId: string; lines: string[] };
    expect(card.kind).toBe("pending");
    expect(card.lines).toContain("Nubank → Reserva");
    expect((await client.get("/api/v1/transactions")).json().total).toBe(0);

    const confirm = await client.post(`/api/v1/ai/actions/${card.actionId}/confirm`);
    expect(confirm.statusCode, confirm.body).toBe(200);
    expect((await client.get("/api/v1/transactions")).json().items[0]).toMatchObject({ type: "transfer", amountCents: 20000 });
    expect((await client.post(`/api/v1/ai/actions/${card.actionId}/confirm`)).statusCode).toBe(409);
  });

  it("recusar a ação não altera nada", async () => {
    const client = await userWithAccount("reject", ["Nubank", "Reserva"]);
    llm.script({ tools: [{ name: "create_transfer", input: { from_account: "Nubank", to_account: "Reserva", amount: 10 } }] }, { text: "Confirme abaixo." });
    const { events: ev } = await chat(client, "transfere 10");
    const actionId = (ev.find((e) => e.type === "card")!.card as { actionId: string }).actionId;
    expect((await client.post(`/api/v1/ai/actions/${actionId}/reject`)).json()).toEqual({ status: "rejected" });
    expect((await client.post(`/api/v1/ai/actions/${actionId}/confirm`)).statusCode).toBe(409);
    expect((await client.get("/api/v1/transactions")).json().total).toBe(0);
  });

  it("exclusão pedida ao NORBIUS exige confirmação e pode ser desfeita", async () => {
    const client = await userWithAccount("delete");
    const accounts = (await client.get("/api/v1/accounts")).json();
    const cats = (await client.get("/api/v1/categories")).json();
    const tx = (
      await client.post("/api/v1/transactions", { type: "expense", accountId: accounts[0].id, amountCents: 999, categoryId: cats[0].id, description: "Café", date: today })
    ).json();
    llm.script({ tools: [{ name: "delete_transaction", input: { transaction_id: tx.id } }] }, { text: "Confirme." });
    const { events: ev } = await chat(client, "apaga o café");
    const actionId = (ev.find((e) => e.type === "card")!.card as { actionId: string }).actionId;
    expect((await client.get("/api/v1/transactions")).json().total).toBe(1);
    const done = (await client.post(`/api/v1/ai/actions/${actionId}/confirm`)).json();
    expect((await client.get("/api/v1/transactions")).json().total).toBe(0);
    await client.post(done.card.undo.path, {});
    expect((await client.get("/api/v1/transactions")).json().total).toBe(1);
  });
});

describe("isolamento e limites", () => {
  it("B não acessa conversa nem confirma ação de A", async () => {
    const a = await userWithAccount("iso-a", ["Nubank", "Reserva"]);
    const b = await userWithAccount("iso-b");
    llm.script({ tools: [{ name: "create_transfer", input: { from_account: "Nubank", to_account: "Reserva", amount: 1 } }] }, { text: "ok" });
    const { events: ev } = await chat(a, "transfere 1");
    const conversationId = ev[0]!.id as string;
    const actionId = (ev.find((e) => e.type === "card")!.card as { actionId: string }).actionId;
    expect((await b.get(`/api/v1/ai/conversations/${conversationId}`)).statusCode).toBe(404);
    expect((await b.post(`/api/v1/ai/actions/${actionId}/confirm`)).statusCode).toBe(404);
    expect((await b.post(`/api/v1/ai/actions/${actionId}/reject`)).statusCode).toBe(404);
    const hijack = await b.post("/api/v1/ai/chat", { message: "oi", conversationId });
    expect(hijack.statusCode).toBe(404);
    expect((await b.get("/api/v1/ai/conversations")).json()).toHaveLength(0);
  });

  it("exige sessão", async () => {
    expect((await ctx.app.inject({ method: "POST", url: "/api/v1/ai/chat", payload: { message: "oi" } })).statusCode).toBe(401);
  });

  it("valida a mensagem", async () => {
    const client = await userWithAccount("valid");
    expect((await client.post("/api/v1/ai/chat", { message: "   " })).statusCode).toBe(400);
    expect((await client.post("/api/v1/ai/chat", { message: "x".repeat(2001) })).statusCode).toBe(400);
  });

  it("memórias são visíveis e apagáveis", async () => {
    const client = await userWithAccount("memory");
    llm.script({ tools: [{ name: "remember", input: { content: "Recebe salário no dia 5", kind: "fact" } }] }, { text: "Anotado." });
    await chat(client, "lembra que recebo dia 5");
    const list = (await client.get("/api/v1/ai/memories")).json();
    expect(list).toMatchObject([{ content: "Recebe salário no dia 5", kind: "fact" }]);
    llm.script((params) => {
      expect(params.system[1]!.text).toContain("Recebe salário no dia 5");
      return { text: "ok" };
    });
    await chat(client, "oi");
    expect((await client.request({ method: "DELETE", url: `/api/v1/ai/memories/${list[0].id}` })).statusCode).toBe(204);
    expect((await client.get("/api/v1/ai/memories")).json()).toHaveLength(0);
  });
});

describe("cota e disponibilidade", () => {
  it("bloqueia ao atingir o limite mensal (JSON, antes do stream)", async () => {
    const limited = await createTestApp({ AI_MONTHLY_MESSAGE_LIMIT: "1" }, { llm: new ScriptedLlm().script({ text: "oi" }) });
    try {
      const { client } = await verifiedClient(limited, "ai-quota");
      expect((await client.post("/api/v1/ai/chat", { message: "oi" })).statusCode).toBe(200);
      const second = await client.post("/api/v1/ai/chat", { message: "de novo" });
      expect(second.statusCode).toBe(429);
      expect(second.json().error.code).toBe("AI_QUOTA_EXCEEDED");
      expect((await client.get("/api/v1/ai/status")).json().usage).toEqual({ used: 1, limit: 1 });
    } finally {
      await limited.close();
    }
  });

  it("sem chave configurada o assistente fica indisponível (sem simulação)", async () => {
    const off = await createTestApp();
    try {
      const { client } = await verifiedClient(off, "ai-off");
      expect((await client.get("/api/v1/ai/status")).json()).toMatchObject({ available: false, model: null });
      const res = await client.post("/api/v1/ai/chat", { message: "oi" });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("AI_UNAVAILABLE");
    } finally {
      await off.close();
    }
  });
});

describe("verificação de números", () => {
  it("aponta valores citados que não vieram dos dados", () => {
    const evidence = ['{"spent":"R$ 412,90","total":"R$ 1.234,56"}'];
    expect(unverifiedAmounts("Você gastou R$ 412,90 de um total de R$ 1.234,56.", evidence)).toEqual([]);
    expect(unverifiedAmounts("Você gastou R$ 999,00.", evidence)).toEqual(["R$999,00"]);
  });
});
