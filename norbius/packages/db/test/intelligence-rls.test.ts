import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withUserContext } from "../src/client";
import { coreStateEvents, insights, projectionSnapshots, users } from "../src/schema";

const app = createDatabase(process.env.DATABASE_URL ?? "postgres://norbius_app:norbius_app@localhost:5432/norbius", { max: 2 });

let a: string, b: string;

beforeAll(async () => {
  const s = crypto.randomUUID().slice(0, 8);
  const rows = await app.db
    .insert(users)
    .values([
      { name: "A", email: `intel-a-${s}@test.norbius` },
      { name: "B", email: `intel-b-${s}@test.norbius` },
    ])
    .returning({ id: users.id });
  a = rows[0]!.id;
  b = rows[1]!.id;
  await withUserContext(app.db, a, async (tx) => {
    await tx.insert(insights).values({ userId: a, type: "card_limit", severity: "attention", title: "T", body: "B", evidence: {}, fingerprint: "card_limit:x" });
    await tx.insert(projectionSnapshots).values({ userId: a, horizonEnd: "2026-09-30", inputsHash: "h", methodVersion: "1", result: {}, confidence: "low" });
    await tx.insert(coreStateEvents).values({ userId: a, state: "ATTENTION", reasons: [] });
  });
});
afterAll(() => app.close());

describe("isolamento da inteligência", () => {
  it("outro usuário não vê nem altera insights, projeções e estados do CORE", async () => {
    await withUserContext(app.db, b, async (tx) => {
      expect(await tx.select().from(insights)).toHaveLength(0);
      expect(await tx.select().from(projectionSnapshots)).toHaveLength(0);
      expect(await tx.select().from(coreStateEvents)).toHaveLength(0);
      expect(await tx.update(insights).set({ status: "dismissed" }).where(eq(insights.userId, a)).returning()).toHaveLength(0);
    });
  });

  it("fingerprint é único por usuário", async () => {
    await expect(
      withUserContext(app.db, a, (tx) =>
        tx.insert(insights).values({ userId: a, type: "card_limit", severity: "attention", title: "T", body: "B", evidence: {}, fingerprint: "card_limit:x" }),
      ),
    ).rejects.toThrow();
  });

  it("a aplicação não apaga insights nem histórico do CORE", async () => {
    await expect(withUserContext(app.db, a, (tx) => tx.delete(insights))).rejects.toThrow();
    await expect(withUserContext(app.db, a, (tx) => tx.delete(coreStateEvents))).rejects.toThrow();
  });
});
