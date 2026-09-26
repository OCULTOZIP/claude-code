import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withUserContext } from "../src/client";
import { accounts, categories, creditCards, transactions, users } from "../src/schema";

// Isolamento do núcleo financeiro no nível do banco: RLS + FKs compostas +
// trigger de categoria. Mesmo que a API erre, o banco recusa.
const app = createDatabase(process.env.DATABASE_URL ?? "postgres://norbius_app:norbius_app@localhost:5432/norbius", { max: 2 });
const owner = createDatabase(
  process.env.DATABASE_MIGRATION_URL ?? "postgres://norbius_owner:norbius_owner@localhost:5432/norbius",
  { max: 1 },
);

async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as { cause?: { message?: string } }).cause?.message ?? String(err);
  }
  throw new Error("era esperado um erro do banco");
}

let a: string, b: string, accountA: string, accountB: string, categoryB: string, food: string, salary: string;

beforeAll(async () => {
  const s = crypto.randomUUID().slice(0, 8);
  const rows = await app.db
    .insert(users)
    .values([
      { name: "A", email: `fin-a-${s}@test.norbius` },
      { name: "B", email: `fin-b-${s}@test.norbius` },
    ])
    .returning({ id: users.id });
  a = rows[0]!.id;
  b = rows[1]!.id;
  accountA = await withUserContext(app.db, a, async (tx) => {
    const [r] = await tx.insert(accounts).values({ userId: a, name: "Conta A", type: "checking", initialBalanceDate: "2026-09-01" }).returning();
    return r!.id;
  });
  [accountB, categoryB] = await withUserContext(app.db, b, async (tx) => {
    const [acc] = await tx.insert(accounts).values({ userId: b, name: "Conta B", type: "checking", initialBalanceDate: "2026-09-01" }).returning();
    const [cat] = await tx.insert(categories).values({ userId: b, name: "Pets", kind: "expense" }).returning();
    return [acc!.id, cat!.id];
  });
  const sys = await owner.db.select().from(categories).where(isNull(categories.userId));
  food = sys.find((c) => c.systemKey === "alimentacao")!.id;
  salary = sys.find((c) => c.systemKey === "salario")!.id;
});

afterAll(async () => {
  await owner.db.delete(users).where(sql`${users.id} in (${a}, ${b})`);
  await app.close();
  await owner.close();
});

const tx = (overrides: Partial<typeof transactions.$inferInsert> = {}) => ({
  userId: a,
  accountId: accountA,
  type: "expense" as const,
  amountCents: 5000,
  categoryId: food,
  description: "Mercado",
  date: "2026-09-20",
  ...overrides,
});

describe("contas", () => {
  it("cada usuário vê só as próprias contas", async () => {
    const rows = await withUserContext(app.db, a, (t) => t.select().from(accounts));
    expect(rows.map((r) => r.id)).toEqual([accountA]);
  });
});

describe("transações", () => {
  it("usuário registra transação na própria conta", async () => {
    const [row] = await withUserContext(app.db, a, (t) => t.insert(transactions).values(tx()).returning());
    expect(row?.amountCents).toBe(5000);
  });

  it("FK composta impede usar a conta de outro usuário", async () => {
    const msg = await pgError(withUserContext(app.db, a, (t) => t.insert(transactions).values(tx({ accountId: accountB }))));
    expect(msg).toMatch(/foreign key/);
  });

  it("FK composta impede transferir para a conta de outro usuário", async () => {
    const msg = await pgError(
      withUserContext(app.db, a, (t) =>
        t.insert(transactions).values(tx({ type: "transfer", categoryId: null, transferAccountId: accountB })),
      ),
    );
    expect(msg).toMatch(/foreign key/);
  });

  it("não é possível usar categoria personalizada de outro usuário", async () => {
    const msg = await pgError(withUserContext(app.db, a, (t) => t.insert(transactions).values(tx({ categoryId: categoryB }))));
    expect(msg).toMatch(/categoria inacessível/);
  });

  it("categoria precisa ser do tipo da transação", async () => {
    const msg = await pgError(withUserContext(app.db, a, (t) => t.insert(transactions).values(tx({ categoryId: salary }))));
    expect(msg).toMatch(/incompatível/);
  });

  it("rejeita valor zero ou negativo", async () => {
    expect(await pgError(withUserContext(app.db, a, (t) => t.insert(transactions).values(tx({ amountCents: 0 }))))).toMatch(
      /transactions_amount_check/,
    );
  });

  it("transferência exige destino e não aceita categoria", async () => {
    expect(
      await pgError(withUserContext(app.db, a, (t) => t.insert(transactions).values(tx({ type: "transfer" })))),
    ).toMatch(/check constraint/);
  });

  it("usuário B não enxerga transações de A", async () => {
    const rows = await withUserContext(app.db, b, (t) => t.select().from(transactions));
    expect(rows).toHaveLength(0);
  });
});

describe("categorias", () => {
  it("categorias do sistema são visíveis a todos e as personalizadas só ao dono", async () => {
    const seenByA = await withUserContext(app.db, a, (t) => t.select().from(categories));
    expect(seenByA.some((c) => c.id === food)).toBe(true);
    expect(seenByA.some((c) => c.id === categoryB)).toBe(false);
  });

  it("usuário não altera categoria do sistema", async () => {
    const updated = await withUserContext(app.db, a, (t) =>
      t.update(categories).set({ name: "Hack" }).where(eq(categories.id, food)).returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("usuário não cria categoria do sistema", async () => {
    const msg = await pgError(
      withUserContext(app.db, a, (t) => t.insert(categories).values({ userId: null, name: "X", kind: "expense", systemKey: "x" })),
    );
    expect(msg).toMatch(/row-level security/);
  });
});

describe("cartões", () => {
  it("conta de pagamento padrão precisa ser do próprio usuário", async () => {
    const msg = await pgError(
      withUserContext(app.db, a, (t) =>
        t.insert(creditCards).values({ userId: a, name: "Cartão", limitCents: 100000, closingDay: 3, dueDay: 10, defaultPaymentAccountId: accountB }),
      ),
    );
    expect(msg).toMatch(/foreign key/);
  });

  it("valida dias de fechamento e vencimento", async () => {
    const msg = await pgError(
      withUserContext(app.db, a, (t) => t.insert(creditCards).values({ userId: a, name: "X", limitCents: 1, closingDay: 32, dueDay: 10 })),
    );
    expect(msg).toMatch(/closing_day_check/);
  });
});

describe("exclusão de usuário", () => {
  it("apaga em cascata todos os dados financeiros", async () => {
    const s = crypto.randomUUID().slice(0, 8);
    const [u] = await app.db.insert(users).values({ name: "C", email: `fin-c-${s}@test.norbius` }).returning();
    await withUserContext(app.db, u!.id, async (t) => {
      const [acc] = await t.insert(accounts).values({ userId: u!.id, name: "C", type: "wallet", initialBalanceDate: "2026-09-01" }).returning();
      await t.insert(transactions).values(tx({ userId: u!.id, accountId: acc!.id }));
    });
    await owner.db.delete(users).where(eq(users.id, u!.id));
    const left = await owner.db.select().from(transactions).where(and(eq(transactions.userId, u!.id)));
    expect(left).toHaveLength(0);
  });
});
