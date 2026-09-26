import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withUserContext } from "../src/client";
import { accounts, adminUsers, categories, supportAccessGrants, transactions, users } from "../src/schema";

// Critério da Fase 7 (ADR 0007): o papel do painel admin é ESTRUTURALMENTE
// incapaz de ler dados financeiros. Estes testes rodam como norbius_admin.
const appUrl = process.env.DATABASE_URL ?? "postgres://norbius_app:norbius_app@localhost:5432/norbius";
const adminUrl = process.env.DATABASE_ADMIN_URL ?? appUrl.replace("norbius_app:norbius_app", "norbius_admin:norbius_admin");
const app = createDatabase(appUrl, { max: 2 });
const admin = createDatabase(adminUrl, { max: 2 });

const FINANCIAL_TABLES = [
  "transactions",
  "accounts",
  "categories",
  "credit_cards",
  "credit_card_invoices",
  "credit_card_purchases",
  "credit_card_transactions",
  "recurring_transactions",
  "goals",
  "goal_contributions",
  "insights",
  "projection_snapshots",
  "core_state_events",
  "notifications",
  "notification_preferences",
  "ai_conversations",
  "ai_messages",
  "ai_memories",
  "ai_pending_actions",
  "profiles",
  "users",
  "sessions",
  "auth_accounts",
  "verifications",
  "audit_logs",
];

let userId: string, support: string, analyst: string;

/** O drizzle embrulha o erro do Postgres: confere a mensagem original (cause). */
async function denied(p: Promise<unknown>, re: RegExp) {
  const err = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as { message: string; cause?: { message?: string } } | null;
  expect(err, "a operação deveria ter sido recusada").not.toBeNull();
  expect(err!.cause?.message ?? err!.message).toMatch(re);
}

beforeAll(async () => {
  const s = crypto.randomUUID().slice(0, 8);
  const [u] = await app.db.insert(users).values({ name: "Cliente", email: `adm-iso-${s}@test.norbius` }).returning({ id: users.id });
  userId = u!.id;
  await withUserContext(app.db, userId, async (tx) => {
    const [acc] = await tx
      .insert(accounts)
      .values({ userId, name: "Conta", type: "checking", initialBalanceCents: 1000, initialBalanceDate: "2026-01-01" })
      .returning({ id: accounts.id });
    const [salary] = await tx.select({ id: categories.id }).from(categories).where(sql`${categories.systemKey} = 'salario'`);
    await tx.insert(transactions).values({ userId, accountId: acc!.id, type: "income", amountCents: 500_000, categoryId: salary!.id, description: "Salário secreto", date: "2026-09-01" });
  });
  const admins = await admin.db
    .insert(adminUsers)
    .values([
      { email: `sup-${s}@admin.norbius`, name: "Suporte", role: "support", passwordHash: "x", totpSecret: "x" },
      { email: `ana-${s}@admin.norbius`, name: "Analista", role: "analyst", passwordHash: "x", totpSecret: "x" },
    ])
    .returning({ id: adminUsers.id });
  support = admins[0]!.id;
  analyst = admins[1]!.id;
});

afterAll(async () => {
  await app.close();
  await admin.close();
});

describe("papel norbius_admin sem acesso a dados financeiros", () => {
  it.each(FINANCIAL_TABLES)("não lê %s", async (table) => {
    await denied(admin.db.execute(sql.raw(`select 1 from ${table} limit 1`)), /permission denied/);
  });

  it("não escreve em tabelas financeiras nem altera usuários diretamente", async () => {
    await denied(admin.db.execute(sql`update transactions set amount_cents = 1`), /permission denied/);
    await denied(admin.db.execute(sql`update users set status = 'suspended'`), /permission denied/);
    await denied(admin.db.execute(sql`delete from audit_logs`), /permission denied/);
  });

  it("vê cadastro e assinatura sem renda nem valores", async () => {
    const cols = await admin.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'admin_customers' order by column_name`,
    );
    const names = [...cols].map((c) => c.column_name);
    expect(names).toContain("email");
    for (const forbidden of ["avg_monthly_income_cents", "income_frequency", "income_days", "balance_cents"]) expect(names).not.toContain(forbidden);
    const [row] = await admin.db.execute<{ email: string }>(sql`select email from admin_customers where id = ${userId}`);
    expect(row!.email).toContain("adm-iso-");
    const [m] = await admin.db.execute<{ total_users: number }>(sql`select total_users from admin_metrics`);
    expect(m!.total_users).toBeGreaterThan(0);
  });

  it("registro de atividades esconde os detalhes das ações de usuários", async () => {
    await app.db.execute(sql`insert into audit_logs (actor_type, actor_id, subject_user_id, action, metadata) values ('user', ${userId}, ${userId}, 'transaction.create', '{"segredo": 1}')`);
    const rows = await admin.db.execute<{ metadata: object }>(sql`select metadata from admin_audit_logs where subject_user_id = ${userId} and action = 'transaction.create'`);
    expect([...rows].every((r) => JSON.stringify(r.metadata) === "{}")).toBe(true);
  });

  it("a aplicação não enxerga as tabelas de admin", async () => {
    await denied(app.db.execute(sql`select 1 from admin_users`), /permission denied/);
    await denied(app.db.execute(sql`select 1 from admin_sessions`), /permission denied/);
  });
});

describe("ações auditadas e papéis conferidos no banco", () => {
  it("suspender exige papel de suporte e motivo; encerra sessões e registra", async () => {
    await denied(admin.db.execute(sql`select norbius_admin_set_user_status(${analyst}, ${userId}, 'suspended', 'teste de papel', null)`), /sem permissão/);
    await denied(admin.db.execute(sql`select norbius_admin_set_user_status(${support}, ${userId}, 'suspended', 'x', null)`), /motivo/);
    await admin.db.execute(sql`select norbius_admin_set_user_status(${support}, ${userId}, 'suspended', 'Suspeita de fraude', 'req-1')`);
    const [c] = await admin.db.execute<{ status: string }>(sql`select status from admin_customers where id = ${userId}`);
    expect(c!.status).toBe("suspended");
    const log = await admin.db.execute(sql`select 1 from admin_audit_logs where action = 'admin.user.suspend' and subject_user_id = ${userId} and actor_id = ${support}`);
    expect(log.length).toBe(1);
    await admin.db.execute(sql`select norbius_admin_set_user_status(${support}, ${userId}, 'active', 'Resolvido com o cliente', null)`);
  });

  it("transações só com autorização válida do próprio usuário; cada leitura avisa o usuário", async () => {
    await denied(admin.db.execute(sql`select * from norbius_support_transactions(${support}, ${crypto.randomUUID()}, 10, null)`), /autorização/);
    const [grant] = await withUserContext(app.db, userId, (tx) =>
      tx
        .insert(supportAccessGrants)
        .values({ userId, scope: ["transactions:read"], reason: "Chamado 123", expiresAt: new Date(Date.now() + 3_600_000) })
        .returning({ id: supportAccessGrants.id }),
    );
    await denied(admin.db.execute(sql`select * from norbius_support_transactions(${analyst}, ${grant!.id}, 10, null)`), /sem permissão/);
    const rows = await admin.db.execute<{ tx_description: string; amount_cents: string }>(
      sql`select * from norbius_support_transactions(${support}, ${grant!.id}, 10, 'req-2')`,
    );
    expect([...rows].map((r) => r.tx_description)).toEqual(["Salário secreto"]);
    const notified = await withUserContext(app.db, userId, (tx) => tx.execute(sql`select title from notifications where type = 'insight'`));
    expect([...notified].map((n) => (n as { title: string }).title)).toContain("O suporte acessou suas transações");

    await withUserContext(app.db, userId, (tx) => tx.update(supportAccessGrants).set({ revokedAt: new Date() }));
    await denied(admin.db.execute(sql`select * from norbius_support_transactions(${support}, ${grant!.id}, 10, null)`), /autorização/);
  });

  it("autorização de outro usuário não aparece para a aplicação", async () => {
    const [other] = await app.db.insert(users).values({ name: "Outro", email: `adm-iso2-${crypto.randomUUID().slice(0, 8)}@test.norbius` }).returning({ id: users.id });
    await withUserContext(app.db, other!.id, async (tx) => {
      expect(await tx.select().from(supportAccessGrants)).toHaveLength(0);
    });
  });
});
