import { schema, withUserContext, type Database } from "@norbius/db";
import { desc, eq } from "drizzle-orm";
import { notFound } from "../../plugins/errors";

const m = schema.aiMemories;
export const MAX_MEMORIES = 50;

export type MemoryView = { id: string; content: string; kind: "preference" | "fact" | "context"; createdAt: string };

/** Memórias de longo prazo: sempre visíveis e apagáveis pelo usuário. */
export class MemoriesService {
  constructor(private readonly db: Database) {}

  list(userId: string): Promise<MemoryView[]> {
    return withUserContext(this.db, userId, async (tx) =>
      (await tx.select().from(m).orderBy(desc(m.createdAt)).limit(MAX_MEMORIES)).map((r) => ({
        id: r.id,
        content: r.content,
        kind: r.kind,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  }

  add(userId: string, content: string, kind: MemoryView["kind"]) {
    return withUserContext(this.db, userId, async (tx) => {
      const count = (await tx.select({ id: m.id }).from(m)).length;
      if (count >= MAX_MEMORIES) return null;
      const [row] = await tx.insert(m).values({ userId, content, kind }).returning({ id: m.id });
      return row!.id;
    });
  }

  remove(userId: string, id: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx.delete(m).where(eq(m.id, id)).returning({ id: m.id });
      if (!row) throw notFound("Memória");
    });
  }
}
