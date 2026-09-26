import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withUserContext } from "../src/client";
import { auditLogs, profiles, users } from "../src/schema";

// Testes de isolamento no nível do banco. Rodam contra um Postgres real com
// o papel da aplicação (norbius_app), exatamente como em produção.
const appUrl = process.env.DATABASE_URL ?? "postgres://norbius_app:norbius_app@localhost:5432/norbius";
const ownerUrl =
  process.env.DATABASE_MIGRATION_URL ?? "postgres://norbius_owner:norbius_owner@localhost:5432/norbius";

const app = createDatabase(appUrl, { max: 2 });
const owner = createDatabase(ownerUrl, { max: 1 });

/** Drizzle embrulha o erro do Postgres em `cause`. */
async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    return cause?.message ?? String(err);
  }
  throw new Error("era esperado um erro do banco");
}

let userA: string;
let userB: string;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [a, b] = await app.db
    .insert(users)
    .values([
      { name: "A", email: `rls-a-${suffix}@test.norbius` },
      { name: "B", email: `rls-b-${suffix}@test.norbius` },
    ])
    .returning({ id: users.id });
  userA = a!.id;
  userB = b!.id;
  await withUserContext(app.db, userA, (tx) => tx.insert(profiles).values({ userId: userA, displayName: "Ana" }));
  await withUserContext(app.db, userB, (tx) => tx.insert(profiles).values({ userId: userB, displayName: "Bruno" }));
});

afterAll(async () => {
  await owner.db.delete(users).where(sql`${users.id} in (${userA}, ${userB})`);
  await app.close();
  await owner.close();
});

describe("RLS de profiles", () => {
  it("usuário só enxerga o próprio perfil", async () => {
    const rows = await withUserContext(app.db, userA, (tx) => tx.select().from(profiles));
    expect(rows.map((r) => r.userId)).toEqual([userA]);
  });

  it("sem contexto de usuário nenhuma linha é visível", async () => {
    const rows = await app.db.select().from(profiles);
    expect(rows).toHaveLength(0);
  });

  it("não é possível alterar o perfil de outro usuário", async () => {
    const updated = await withUserContext(app.db, userA, (tx) =>
      tx.update(profiles).set({ displayName: "invasor" }).where(eq(profiles.userId, userB)).returning(),
    );
    expect(updated).toHaveLength(0);
    const [b] = await owner.db.select().from(profiles).where(eq(profiles.userId, userB));
    expect(b?.displayName).toBe("Bruno");
  });

  it("não é possível inserir linha em nome de outro usuário", async () => {
    const message = await pgError(
      withUserContext(app.db, userA, (tx) =>
        tx.insert(profiles).values({ userId: userB, displayName: "x" }).onConflictDoNothing(),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it("rejeita userId que não é UUID", async () => {
    await expect(withUserContext(app.db, "1 or 1=1", async () => 0)).rejects.toThrow(/inválido/);
  });
});

describe("audit_logs", () => {
  it("aplicação pode inserir mas não ler", async () => {
    await app.db.insert(auditLogs).values({ actorType: "system", action: "test.rls" });
    expect(await pgError(app.db.select().from(auditLogs))).toMatch(/permission denied/);
  });
});
