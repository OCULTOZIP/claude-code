import { createDatabase, schema } from "@norbius/db";
import { randomBytes } from "node:crypto";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { passwordHasher } from "../src/lib/password";
import { encrypt, loadKey } from "../src/modules/admin/crypto";
import { base32Encode, currentStep, newTotpSecret, totpAt, verifyTotp } from "../src/modules/admin/totp";
import { createTestApp, proClient, TestClient, verifiedClient } from "./helpers";

const ADMIN_URL = "http://localhost:3001";
const KEY = randomBytes(32).toString("base64");
const appUrl = process.env.DATABASE_URL ?? "postgres://norbius_app:norbius_app@localhost:5432/norbius";
const adminUrl = process.env.DATABASE_ADMIN_URL ?? appUrl.replace("norbius_app:norbius_app", "norbius_admin:norbius_admin");
const owner = createDatabase(process.env.DATABASE_MIGRATION_URL ?? "postgres://norbius_owner:norbius_owner@localhost:5432/norbius", { max: 1 });
const adminDb = createDatabase(adminUrl, { max: 1 });
const PASSWORD = "senha-admin-bem-forte";
const tag = crypto.randomUUID().slice(0, 6);

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const secrets: Record<string, string> = {};
let seq = 0;

async function createAdmin(role: "support" | "billing" | "analyst" | "superadmin") {
  const secret = newTotpSecret();
  const email = `${role}${++seq}-${tag}@admin.norbius`;
  await adminDb.db.insert(schema.adminUsers).values({ email, name: role, role, passwordHash: await passwordHasher.hash(PASSWORD), totpSecret: encrypt(loadKey(KEY), secret) });
  secrets[email] = secret;
  return email;
}

/** Faz login completo (senha + TOTP) e devolve o cliente com o cookie do painel. */
async function login(email: string, stepOffset = 0) {
  const c = new TestClient(ctx.app);
  const h = { origin: ADMIN_URL };
  const r1 = await c.request({ method: "POST", url: "/api/admin/auth/login", payload: { email, password: PASSWORD }, headers: h });
  expect(r1.statusCode, r1.body).toBe(200);
  const code = totpAt(secrets[email]!, currentStep() + stepOffset);
  const r2 = await c.request({ method: "POST", url: "/api/admin/auth/totp", payload: { challenge: r1.json().challenge, code }, headers: h });
  expect(r2.statusCode, r2.body).toBe(200);
  return c;
}
const get = (c: TestClient, url: string) => c.request({ method: "GET", url, headers: { origin: ADMIN_URL } });
const post = (c: TestClient, url: string, payload: object) => c.request({ method: "POST", url, payload, headers: { origin: ADMIN_URL } });

beforeAll(async () => {
  ctx = await createTestApp({ DATABASE_ADMIN_URL: adminUrl, ADMIN_ENCRYPTION_KEY: KEY, ADMIN_URL });
});

afterAll(async () => {
  await owner.db.delete(schema.adminUsers).where(like(schema.adminUsers.email, `%-${tag}@admin.norbius`));
  await owner.db.delete(schema.users).where(like(schema.users.email, "adm-%@test.norbius"));
  await ctx.close();
  await owner.close();
  await adminDb.close();
});

describe("TOTP", () => {
  it("segue o vetor da RFC 6238 e não aceita o mesmo passo duas vezes", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, 1)).toBe("287082"); // T = 59 s
    expect(totpAt(secret, 37037036)).toBe("081804"); // T = 1111111109 s
    const step = currentStep();
    expect(verifyTotp(secret, totpAt(secret, step), 0)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step), step)).toBeNull();
  });
});

describe("login do painel", () => {
  it("exige senha e código; recusa código errado e reuso do mesmo código", async () => {
    const email = await createAdmin("analyst");
    const c = new TestClient(ctx.app);
    const h = { origin: ADMIN_URL };
    expect((await c.request({ method: "POST", url: "/api/admin/auth/login", payload: { email, password: "errada-errada" }, headers: h })).statusCode).toBe(401);
    const r1 = await c.request({ method: "POST", url: "/api/admin/auth/login", payload: { email, password: PASSWORD }, headers: h });
    const challenge = r1.json().challenge as string;
    expect((await c.request({ method: "POST", url: "/api/admin/auth/totp", payload: { challenge, code: "000000" }, headers: h })).statusCode).toBe(401);
    const code = totpAt(secrets[email]!, currentStep());
    const ok = await c.request({ method: "POST", url: "/api/admin/auth/totp", payload: { challenge, code }, headers: h });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["set-cookie"]).toMatch(/norbius_admin=.+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800/);
    expect((await get(c, "/api/admin/me")).json()).toMatchObject({ email, role: "analyst" });
    const again = new TestClient(ctx.app);
    const r = await again.request({ method: "POST", url: "/api/admin/auth/login", payload: { email, password: PASSWORD }, headers: h });
    expect((await again.request({ method: "POST", url: "/api/admin/auth/totp", payload: { challenge: r.json().challenge, code }, headers: h })).statusCode).toBe(401);
  });

  it("recusa escrita vinda de outra origem e sessão de usuário comum", async () => {
    const email = await createAdmin("support");
    expect((await ctx.app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { email, password: PASSWORD }, headers: { origin: "http://localhost:3000" } })).statusCode).toBe(403);
    const { client } = await verifiedClient(ctx, "adm-comum");
    expect((await client.get("/api/admin/metrics")).statusCode).toBe(401);
  });

  it("bloqueia depois de 5 tentativas erradas", async () => {
    const email = await createAdmin("billing");
    const h = { origin: ADMIN_URL };
    for (let i = 0; i < 5; i++) await ctx.app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { email, password: "errada-errada" }, headers: h });
    const res = await ctx.app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { email, password: PASSWORD }, headers: h });
    expect(res.statusCode).toBe(429);
  });
});

describe("papéis e ações", () => {
  let support: TestClient, billing: TestClient, analyst: TestClient;
  let user: TestClient, userId: string;

  beforeAll(async () => {
    support = await login(await createAdmin("support"));
    billing = await login(await createAdmin("billing"));
    analyst = await login(await createAdmin("analyst"));
    const u = await proClient(ctx, "adm-cliente");
    user = u.client;
    const [row] = await owner.db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.email, u.email));
    userId = row!.id;
  });

  it("analista vê métricas, mas não a lista de clientes", async () => {
    const m = await get(analyst, "/api/admin/metrics");
    expect(m.statusCode).toBe(200);
    expect(m.json().users.total).toBeGreaterThan(0);
    expect((await get(analyst, "/api/admin/customers")).statusCode).toBe(403);
  });

  it("suporte encontra o cliente (sem dados financeiros) e registra a visualização", async () => {
    const list = await get(support, `/api/admin/customers?search=adm-cliente`);
    expect(list.statusCode).toBe(200);
    const detail = (await get(support, `/api/admin/customers/${userId}`)).json();
    expect(detail).toMatchObject({ id: userId, plan: "pro", planReason: "trial" });
    expect(JSON.stringify(detail)).not.toMatch(/balance|amount_cents|income/i);
    const audit = (await get(support, `/api/admin/audit?action=admin.user.view&userId=${userId}`)).json() as { action: string }[];
    expect(audit.length).toBeGreaterThan(0);
  });

  it("suspender exige motivo e derruba a sessão do usuário; reativar devolve o acesso", async () => {
    expect((await post(support, `/api/admin/customers/${userId}/status`, { status: "suspended", reason: "x" })).statusCode).toBe(400);
    expect((await post(billing, `/api/admin/customers/${userId}/status`, { status: "suspended", reason: "motivo válido" })).statusCode).toBe(403);
    expect((await post(support, `/api/admin/customers/${userId}/status`, { status: "suspended", reason: "Chargeback em análise" })).statusCode).toBe(204);
    expect((await user.get("/api/v1/me")).statusCode).toBe(401);
    expect((await post(support, `/api/admin/customers/${userId}/status`, { status: "active", reason: "Análise concluída" })).statusCode).toBe(204);
  });

  it("cobrança libera dias de teste grátis", async () => {
    const res = await post(billing, `/api/admin/customers/${userId}/trial`, { days: 30, reason: "Cortesia pelo suporte" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().trialEndsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await post(support, `/api/admin/customers/${userId}/trial`, { days: 30, reason: "sem papel" })).statusCode).toBe(403);
  });

  it("acesso excepcional: só com autorização do usuário, auditado, avisado e revogável", async () => {
    const { client, email } = await verifiedClient(ctx, "adm-grant");
    const cats = (await client.get("/api/v1/categories")).json() as { id: string; name: string }[];
    const acc = (await client.post("/api/v1/accounts", { name: "Conta", type: "checking", initialBalanceCents: 0 })).json() as { id: string };
    await client.post("/api/v1/transactions", { type: "expense", accountId: acc.id, amountCents: 1234, categoryId: cats.find((c) => c.name === "Alimentação")!.id, description: "Padaria", date: "2026-09-01" });

    expect((await client.post("/api/v1/support/grants", { reason: "x", hours: 24 })).statusCode).toBe(400);
    const grant = await client.post("/api/v1/support/grants", { reason: "Chamado 987: saldo errado", hours: 24 });
    expect(grant.statusCode, grant.body).toBe(201);
    const id = grant.json().id as string;

    expect((await get(analyst, `/api/admin/grants/${id}/transactions`)).statusCode).toBe(403);
    const rows = await get(support, `/api/admin/grants/${id}/transactions`);
    expect(rows.statusCode, rows.body).toBe(200);
    expect(rows.json()).toEqual([expect.objectContaining({ description: "Padaria", amountCents: 1234, type: "expense" })]);
    const notes = (await client.get("/api/v1/notifications")).json() as { items: { title: string }[] };
    expect(notes.items.map((n) => n.title)).toContain("O suporte acessou suas transações");

    expect((await client.post(`/api/v1/support/grants/${id}/revoke`)).statusCode).toBe(204);
    expect((await get(support, `/api/admin/grants/${id}/transactions`)).statusCode).toBe(403);
    expect(email).toContain("adm-grant");
  });

  it("só superadmin gerencia administradores", async () => {
    expect((await get(support, "/api/admin/admins")).statusCode).toBe(403);
    const root = await login(await createAdmin("superadmin"));
    const list = (await get(root, "/api/admin/admins")).json() as { email: string }[];
    expect(list.length).toBeGreaterThan(0);
    expect(JSON.stringify(list)).not.toMatch(/password|totp/i);
  });
});
