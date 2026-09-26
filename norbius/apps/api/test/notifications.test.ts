import { createDatabase, schema } from "@norbius/db";
import { todayIn } from "@norbius/domain";
import type { NotificationPreference, NotificationsList } from "@norbius/contracts";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, proClient, verifiedClient, type TestClient } from "./helpers";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const owner = createDatabase(
  process.env.DATABASE_MIGRATION_URL ?? "postgres://norbius_owner:norbius_owner@localhost:5432/norbius",
  { max: 1 },
);
const today = todayIn("America/Sao_Paulo");
const n = schema.notifications;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  await owner.db.delete(schema.users).where(like(schema.users.email, "notif-%@test.norbius"));
  await ctx.close();
  await owner.close();
});

/** Cartão com 96% do limite: gera o alerta card_limit (disponível no plano Grátis). */
async function fullCard(client: TestClient, name = "Roxinho") {
  const cats = (await client.get("/api/v1/categories")).json() as { id: string; name: string }[];
  await client.post("/api/v1/accounts", { name: "Conta", type: "checking", initialBalanceCents: 100_000 });
  const card = (await client.post("/api/v1/cards", { name, limitCents: 100_000, closingDay: 3, dueDay: 10 })).json() as { id: string };
  const res = await client.post("/api/v1/card-purchases", {
    creditCardId: card.id,
    description: "Compra",
    totalAmountCents: 96_000,
    installmentCount: 1,
    purchaseDate: today,
    categoryId: cats.find((c) => c.name === "Compras")!.id,
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function userId(email: string) {
  const [u] = await owner.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  return u!.id;
}

describe("notificações a partir de insights", () => {
  let ana: TestClient;
  let anaEmail: string;
  let bia: TestClient;

  beforeAll(async () => {
    ({ client: ana, email: anaEmail } = await verifiedClient(ctx, "notif-ana"));
    bia = (await verifiedClient(ctx, "notif-bia")).client;
    await fullCard(ana);
    expect((await ana.get("/api/v1/intelligence")).statusCode).toBe(200);
  });

  it("cria um aviso no app e agenda o e-mail, sem duplicar em novas análises", async () => {
    await ana.get("/api/v1/intelligence");
    const list = (await ana.get("/api/v1/notifications")).json() as NotificationsList;
    expect(list.unread).toBe(1);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ type: "card_limit", title: "Roxinho: 96% do limite usado", severity: "critical", read: false });
    const rows = await owner.db.select().from(n).where(eq(n.userId, await userId(anaEmail)));
    expect(rows.map((r) => `${r.channel}:${r.status}`).sort()).toEqual(["email:pending", "in_app:sent"]);
    expect(rows.find((r) => r.channel === "email")!.scheduledFor.getTime()).toBeGreaterThanOrEqual(rows[0]!.createdAt.getTime() - 1000);
  });

  it("marca como lida; outro usuário não consegue", async () => {
    const { items } = (await ana.get("/api/v1/notifications")).json() as NotificationsList;
    expect((await bia.post(`/api/v1/notifications/${items[0]!.id}/read`)).statusCode).toBe(404);
    expect((await ana.post(`/api/v1/notifications/${items[0]!.id}/read`)).statusCode).toBe(204);
    const after = (await ana.get("/api/v1/notifications")).json() as NotificationsList;
    expect(after.unread).toBe(0);
    expect(after.items[0]!.read).toBe(true);
    expect(((await bia.get("/api/v1/notifications")).json() as NotificationsList).items).toEqual([]);
  });

  it("o job envia o e-mail quando passa o horário silencioso", async () => {
    const future = new Date(Date.now() + 24 * 3_600_000);
    await ctx.app.jobs.tick(future);
    const mail = ctx.mailer.lastTo(anaEmail)!;
    expect(mail.subject).toBe("NORBIUS: Roxinho: 96% do limite usado");
    expect(mail.text).toContain("/configuracoes/notificacoes");
    const [email] = await owner.db
      .select()
      .from(n)
      .where(and(eq(n.userId, await userId(anaEmail)), eq(n.channel, "email")));
    expect(email).toMatchObject({ status: "sent", attempts: 1 });
  });
});

describe("preferências", () => {
  it("padrões por tipo, salvar e respeitar ao criar e ao enviar", async () => {
    const { client, email } = await verifiedClient(ctx, "notif-pref");
    const defaults = (await client.get("/api/v1/notifications/preferences")).json() as NotificationPreference[];
    expect(defaults.find((p) => p.type === "card_limit")).toEqual({ type: "card_limit", inApp: true, email: true });
    expect(defaults.find((p) => p.type === "insight")).toEqual({ type: "insight", inApp: true, email: false });

    const res = await client.request({
      method: "PUT",
      url: "/api/v1/notifications/preferences",
      payload: { preferences: [{ type: "card_limit", inApp: false, email: false }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as NotificationPreference[]).find((p) => p.type === "card_limit")).toEqual({ type: "card_limit", inApp: false, email: false });

    await fullCard(client, "Azul");
    await client.get("/api/v1/intelligence");
    expect(await owner.db.select().from(n).where(eq(n.userId, await userId(email)))).toEqual([]);
    expect(((await client.get("/api/v1/intelligence")).json() as { insights: unknown[] }).insights).toHaveLength(1);
  });

  it("rejeita tipo desconhecido", async () => {
    const { client } = await verifiedClient(ctx, "notif-bad");
    const res = await client.request({ method: "PUT", url: "/api/v1/notifications/preferences", payload: { preferences: [{ type: "spam", inApp: true, email: true }] } });
    expect(res.statusCode).toBe(400);
  });
});

describe("análise diária", () => {
  it("roda uma vez por dia local, depois das 06:00, e gera os avisos sem o usuário abrir o app", async () => {
    const { client, email } = await proClient(ctx, "notif-daily");
    await fullCard(client, "Diário");
    const id = await userId(email);
    const noon = new Date(`${today}T15:00:00Z`); // 12h em São Paulo
    await ctx.app.jobs.runDailyAnalysis(noon);
    const [run] = await owner.db.select().from(schema.intelligenceRuns).where(eq(schema.intelligenceRuns.userId, id));
    expect(run!.lastDailyRunOn).toBe(today);
    expect((await owner.db.select().from(n).where(and(eq(n.userId, id), eq(n.channel, "in_app")))).map((r) => r.type)).toEqual(["card_limit"]);

    // Mesmo dia: não roda de novo.
    await owner.db.update(schema.intelligenceRuns).set({ updatedAt: new Date(0) }).where(eq(schema.intelligenceRuns.userId, id));
    await ctx.app.jobs.runDailyAnalysis(new Date(`${today}T20:00:00Z`));
    const [again] = await owner.db.select().from(schema.intelligenceRuns).where(eq(schema.intelligenceRuns.userId, id));
    expect(again!.updatedAt.getTime()).toBe(0);
  });

  it("antes das 06:00 locais ninguém é analisado", async () => {
    const { email } = await verifiedClient(ctx, "notif-early");
    const id = await userId(email);
    await ctx.app.jobs.runDailyAnalysis(new Date(`${today}T08:00:00Z`)); // 05h em São Paulo
    expect(await owner.db.select().from(schema.intelligenceRuns).where(eq(schema.intelligenceRuns.userId, id))).toEqual([]);
  });
});
