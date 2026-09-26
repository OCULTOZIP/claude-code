import { createDatabase, schema } from "@norbius/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, extractLink, TestClient, uniqueEmail } from "./helpers";

const PASSWORD = "senha-muito-forte-123";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
const owner = createDatabase(
  process.env.DATABASE_MIGRATION_URL ?? "postgres://norbius_owner:norbius_owner@localhost:5432/norbius",
  { max: 1 },
);
const createdEmails: string[] = [];

beforeAll(async () => {
  ctx = await createTestApp();
});

afterAll(async () => {
  if (createdEmails.length) await owner.db.delete(schema.users).where(inArray(schema.users.email, createdEmails));
  await ctx.close();
  await owner.close();
});

async function signUp(client: TestClient, email: string, name = "Ana Teste") {
  createdEmails.push(email);
  return client.post("/api/auth/sign-up/email", { name, email, password: PASSWORD, acceptTerms: true });
}

/** Cadastra e verifica o e-mail; o cliente sai autenticado. */
async function verifiedUser(tag: string) {
  const client = new TestClient(ctx.app);
  const email = uniqueEmail(tag);
  const res = await signUp(client, email);
  expect(res.statusCode).toBe(200);
  const link = extractLink(ctx.mailer.lastTo(email)!.text);
  const verify = await client.get(link.pathname + link.search);
  expect([200, 302]).toContain(verify.statusCode);
  expect(client.hasSession()).toBe(true);
  return { client, email };
}

describe("cadastro", () => {
  it("exige aceite dos termos no servidor", async () => {
    const client = new TestClient(ctx.app);
    const email = uniqueEmail("noterms");
    createdEmails.push(email);
    const res = await client.post("/api/auth/sign-up/email", { name: "X", email, password: PASSWORD });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("TERMS_NOT_ACCEPTED");
  });

  it("rejeita senha curta", async () => {
    const client = new TestClient(ctx.app);
    const email = uniqueEmail("short");
    createdEmails.push(email);
    const res = await client.post("/api/auth/sign-up/email", { name: "X", email, password: "123", acceptTerms: true });
    expect(res.statusCode).toBe(400);
  });

  it("cria usuário, perfil, consentimentos e envia verificação sem abrir sessão", async () => {
    const client = new TestClient(ctx.app);
    const email = uniqueEmail("signup");
    const res = await signUp(client, email, "Beatriz");
    expect(res.statusCode).toBe(200);
    expect(client.hasSession()).toBe(false);
    expect(ctx.mailer.lastTo(email)?.subject).toMatch(/Confirme seu e-mail/);

    const [user] = await owner.db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(user?.emailVerified).toBe(false);
    const [profile] = await owner.db.select().from(schema.profiles).where(eq(schema.profiles.userId, user!.id));
    expect(profile?.displayName).toBe("Beatriz");
    const consents = await owner.db.select().from(schema.consents).where(eq(schema.consents.userId, user!.id));
    expect(consents.map((c) => c.kind).sort()).toEqual(["privacy", "terms"]);
  });

  it("não revela se o e-mail já está cadastrado", async () => {
    const email = uniqueEmail("dup");
    const first = await signUp(new TestClient(ctx.app), email);
    const second = await signUp(new TestClient(ctx.app), email);
    expect(second.statusCode).toBe(first.statusCode);
  });
});

describe("login e verificação de e-mail", () => {
  it("bloqueia login antes da verificação", async () => {
    const client = new TestClient(ctx.app);
    const email = uniqueEmail("unverified");
    await signUp(client, email);
    const res = await client.post("/api/auth/sign-in/email", { email, password: PASSWORD });
    expect(res.statusCode).toBe(403);
    expect(client.hasSession()).toBe(false);
  });

  it("verificação abre sessão e libera /me", async () => {
    const { client, email } = await verifiedUser("verify");
    const me = await client.get("/api/v1/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email);
    expect(me.json().profile.onboardingStatus).toBe("not_started");
  });

  it("login com senha errada falha com mensagem genérica", async () => {
    const { email } = await verifiedUser("wrongpw");
    const res = await new TestClient(ctx.app).post("/api/auth/sign-in/email", { email, password: "errada-errada-1" });
    expect(res.statusCode).toBe(401);
  });

  it("login correto após verificação", async () => {
    const { email } = await verifiedUser("login");
    const client = new TestClient(ctx.app);
    const res = await client.post("/api/auth/sign-in/email", { email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect((await client.get("/api/v1/me")).statusCode).toBe(200);
  });

  it("usuário suspenso não consegue abrir sessão", async () => {
    const { email } = await verifiedUser("suspended");
    await owner.db.update(schema.users).set({ status: "suspended" }).where(eq(schema.users.email, email));
    const res = await new TestClient(ctx.app).post("/api/auth/sign-in/email", { email, password: PASSWORD });
    expect(res.statusCode).not.toBe(200);
  });
});

describe("rotas protegidas", () => {
  it("retorna 401 sem sessão", async () => {
    const res = await new TestClient(ctx.app).get("/api/v1/me");
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("cada usuário vê apenas os próprios dados", async () => {
    const a = await verifiedUser("iso-a");
    const b = await verifiedUser("iso-b");
    await a.client.patch("/api/v1/me/profile", { displayName: "Somente A" });
    const meB = (await b.client.get("/api/v1/me")).json();
    expect(meB.user.email).toBe(b.email);
    expect(meB.profile.displayName).not.toBe("Somente A");
  });

  it("atualiza o nome de exibição com validação", async () => {
    const { client } = await verifiedUser("profile");
    const bad = await client.patch("/api/v1/me/profile", { displayName: "   " });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.displayName).toBeDefined();
    const ok = await client.patch("/api/v1/me/profile", { displayName: "Carla" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().profile.displayName).toBe("Carla");
  });

  it("endpoints desativados do Better Auth não respondem", async () => {
    const { client } = await verifiedUser("disabled");
    const res = await client.post("/api/auth/update-user", { name: "x" });
    expect(res.statusCode).toBe(404);
  });
});

describe("sessões e logout", () => {
  it("logout invalida a sessão no servidor", async () => {
    const { client } = await verifiedUser("logout");
    expect((await client.post("/api/auth/sign-out")).statusCode).toBe(200);
    expect((await client.get("/api/v1/me")).statusCode).toBe(401);
  });

  it("lista sessões e encerra as outras", async () => {
    const { client, email } = await verifiedUser("sessions");
    const other = new TestClient(ctx.app);
    await other.post("/api/auth/sign-in/email", { email, password: PASSWORD });
    const list = await client.get("/api/auth/list-sessions");
    expect(list.json()).toHaveLength(2);
    expect((await client.post("/api/auth/revoke-other-sessions")).statusCode).toBe(200);
    expect((await other.get("/api/v1/me")).statusCode).toBe(401);
    expect((await client.get("/api/v1/me")).statusCode).toBe(200);
  });
});

describe("recuperação de senha", () => {
  it("redefine a senha, revoga sessões e avisa por e-mail", async () => {
    const { client, email } = await verifiedUser("reset");
    const anon = new TestClient(ctx.app);
    const req = await anon.post("/api/auth/request-password-reset", { email, redirectTo: "/redefinir-senha" });
    expect(req.statusCode).toBe(200);

    const link = extractLink(ctx.mailer.lastTo(email)!.text);
    const follow = await anon.get(link.pathname + link.search);
    expect(follow.statusCode).toBe(302);
    const token = new URL(follow.headers.location as string, "http://x").searchParams.get("token");
    expect(token).toBeTruthy();

    const reset = await anon.post("/api/auth/reset-password", { token, newPassword: "outra-senha-forte-456" });
    expect(reset.statusCode).toBe(200);
    expect(ctx.mailer.lastTo(email)?.subject).toMatch(/foi alterada/);

    expect((await client.get("/api/v1/me")).statusCode).toBe(401);
    const login = await new TestClient(ctx.app).post("/api/auth/sign-in/email", {
      email,
      password: "outra-senha-forte-456",
    });
    expect(login.statusCode).toBe(200);
  });

  it("não revela se o e-mail existe", async () => {
    const res = await new TestClient(ctx.app).post("/api/auth/request-password-reset", {
      email: uniqueEmail("ghost"),
      redirectTo: "/redefinir-senha",
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("auditoria", () => {
  it("registra cadastro, verificação e sessões", async () => {
    const { email } = await verifiedUser("audit");
    const [user] = await owner.db.select().from(schema.users).where(eq(schema.users.email, email));
    const logs = await owner.db
      .select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.subjectUserId, user!.id));
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.sign_up", "auth.email_verified", "auth.session_created"]));
  });
});

describe("configuração e saúde", () => {
  it("expõe provedores habilitados", async () => {
    const res = await new TestClient(ctx.app).get("/api/v1/auth/config");
    expect(res.json()).toEqual({ providers: { google: false } });
  });

  it("readiness verifica o banco", async () => {
    const res = await new TestClient(ctx.app).get("/api/ready");
    expect(res.statusCode).toBe(200);
    expect(res.json().checks.database).toBe("ok");
  });

  it("toda resposta carrega x-request-id e erro 404 padronizado", async () => {
    const res = await new TestClient(ctx.app).get("/api/v1/nao-existe");
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.json().error.requestId).toBe(res.headers["x-request-id"]);
  });
});

describe("links de verificação", () => {
  it("sempre apontam para a página de confirmação do app", async () => {
    const client = new TestClient(ctx.app);
    const email = uniqueEmail("cb");
    await signUp(client, email);
    const link = extractLink(ctx.mailer.lastTo(email)!.text);
    expect(link.searchParams.get("callbackURL")).toBe("/email-verificado");
    const res = await client.get(link.pathname + link.search);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/email-verificado");
  });
});
