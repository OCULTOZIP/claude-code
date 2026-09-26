import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withUserContext } from "../src/client";
import { aiConversations, aiMemories, aiMessages, users } from "../src/schema";

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

let a: string, b: string, convA: string;

beforeAll(async () => {
  const s = crypto.randomUUID().slice(0, 8);
  const rows = await app.db
    .insert(users)
    .values([
      { name: "A", email: `ai-a-${s}@test.norbius` },
      { name: "B", email: `ai-b-${s}@test.norbius` },
    ])
    .returning({ id: users.id });
  a = rows[0]!.id;
  b = rows[1]!.id;
  convA = await withUserContext(app.db, a, async (tx) => {
    const [c] = await tx.insert(aiConversations).values({ userId: a, title: "privada" }).returning();
    await tx.insert(aiMessages).values({ userId: a, conversationId: c!.id, role: "user", kind: "user_text", content: [{ type: "text", text: "segredo" }] });
    await tx.insert(aiMemories).values({ userId: a, content: "Recebe no dia 5", kind: "fact" });
    return c!.id;
  });
});

afterAll(async () => {
  await owner.db.delete(users).where(sql`${users.id} in (${a}, ${b})`);
  await app.close();
  await owner.close();
});

describe("isolamento da IA", () => {
  it("B não vê conversas, mensagens nem memórias de A", async () => {
    await withUserContext(app.db, b, async (tx) => {
      expect(await tx.select().from(aiConversations)).toHaveLength(0);
      expect(await tx.select().from(aiMessages)).toHaveLength(0);
      expect(await tx.select().from(aiMemories)).toHaveLength(0);
    });
  });

  it("B não consegue escrever na conversa de A", async () => {
    const msg = await pgError(
      withUserContext(app.db, b, (tx) =>
        tx.insert(aiMessages).values({ userId: b, conversationId: convA, role: "user", kind: "user_text", content: [] }),
      ),
    );
    expect(msg).toMatch(/foreign key/);
  });

  it("papel e tipo da mensagem precisam ser coerentes", async () => {
    const msg = await pgError(
      withUserContext(app.db, a, (tx) =>
        tx.insert(aiMessages).values({ userId: a, conversationId: convA, role: "user", kind: "assistant", content: [] }),
      ),
    );
    expect(msg).toMatch(/ai_messages_kind_check/);
  });
});
