import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withUserContext } from "../src/client";
import { billingPayments, subscriptions, users } from "../src/schema";

const app = createDatabase(process.env.DATABASE_URL ?? "postgres://norbius_app:norbius_app@localhost:5432/norbius", { max: 2 });

let a: string, b: string, customer: string;

beforeAll(async () => {
  const s = crypto.randomUUID().slice(0, 8);
  customer = `cus_${s}`;
  const rows = await app.db
    .insert(users)
    .values([
      { name: "A", email: `bill-a-${s}@test.norbius` },
      { name: "B", email: `bill-b-${s}@test.norbius` },
    ])
    .returning({ id: users.id });
  a = rows[0]!.id;
  b = rows[1]!.id;
  await withUserContext(app.db, a, async (tx) => {
    await tx.insert(subscriptions).values({ userId: a, status: "active", provider: "fake", providerCustomerId: customer, paidThrough: "2026-10-25" });
    await tx.insert(billingPayments).values({ userId: a, providerPaymentId: `pay_${s}`, amountCents: 1490, status: "paid", dueDate: "2026-09-26" });
  });
});
afterAll(() => app.close());

describe("isolamento de assinaturas", () => {
  it("outro usuário não vê nem altera assinatura e pagamentos", async () => {
    await withUserContext(app.db, b, async (tx) => {
      expect(await tx.select().from(subscriptions)).toHaveLength(0);
      expect(await tx.select().from(billingPayments)).toHaveLength(0);
      const updated = await tx.update(subscriptions).set({ paidThrough: "2099-12-31" }).where(eq(subscriptions.userId, a)).returning();
      expect(updated).toHaveLength(0);
    });
  });

  it("sem contexto não há linhas", async () => {
    expect(await app.db.select().from(subscriptions)).toHaveLength(0);
  });

  it("a aplicação não apaga histórico de pagamentos", async () => {
    await expect(withUserContext(app.db, a, (tx) => tx.delete(billingPayments))).rejects.toThrow();
  });

  it("webhook resolve o dono só pelo id do cliente no provedor", async () => {
    const [row] = await app.db.execute<{ user_id: string | null }>(sql`select norbius_billing_user(${customer}) as user_id`);
    expect(row!.user_id).toBe(a);
    const [none] = await app.db.execute<{ user_id: string | null }>(sql`select norbius_billing_user('cus_inexistente') as user_id`);
    expect(none!.user_id).toBeNull();
  });
});
