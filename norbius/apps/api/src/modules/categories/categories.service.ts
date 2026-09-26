import type { CategoryView } from "@norbius/contracts";
import { categoryInputSchema } from "@norbius/contracts";
import { schema, withUserContext, type Database, type Transaction } from "@norbius/db";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { badRequest, notFound } from "../../plugins/errors";

const c = schema.categories;

function toView(r: typeof c.$inferSelect): CategoryView {
  return { id: r.id, name: r.name, kind: r.kind, system: r.userId === null, icon: r.icon };
}

/** Categoria acessível (sistema ou própria, não arquivada) e do tipo esperado. */
export async function assertCategory(tx: Transaction, id: string, kind: "income" | "expense") {
  const [row] = await tx.select().from(c).where(and(eq(c.id, id), isNull(c.archivedAt)));
  if (!row) throw badRequest("INVALID_CATEGORY", "Categoria não encontrada.");
  if (row.kind !== kind) {
    throw badRequest("INVALID_CATEGORY", kind === "income" ? "Escolha uma categoria de receita." : "Escolha uma categoria de despesa.");
  }
  return row;
}

/** Categoria do sistema pela chave (ex.: 'salario', 'alimentacao'). */
export async function systemCategory(tx: Transaction, key: string, kind: "income" | "expense") {
  const [row] = await tx.select().from(c).where(and(isNull(c.userId), eq(c.systemKey, key), eq(c.kind, kind)));
  if (!row) throw new Error(`Categoria do sistema ausente: ${key}/${kind}`);
  return row;
}

export class CategoriesService {
  constructor(private readonly db: Database) {}

  list(userId: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const rows = await tx
        .select()
        .from(c)
        .where(isNull(c.archivedAt))
        // Sistema primeiro, "Outros" por último, depois alfabético.
        .orderBy(asc(c.kind), sql`(${c.systemKey} = 'outros')`, asc(c.name));
      return rows.map(toView);
    });
  }

  create(userId: string, input: z.infer<typeof categoryInputSchema>) {
    return withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx.insert(c).values({ userId, name: input.name, kind: input.kind }).returning();
      return toView(row!);
    });
  }

  rename(userId: string, id: string, name: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(c)
        .set({ name })
        .where(and(eq(c.id, id), isNotNull(c.userId)))
        .returning();
      if (!row) throw notFound("Categoria");
      return toView(row);
    });
  }

  /** Arquiva (o histórico continua apontando para ela). Categorias do sistema não podem ser arquivadas. */
  archive(userId: string, id: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(c)
        .set({ archivedAt: new Date() })
        .where(and(eq(c.id, id), isNotNull(c.userId)))
        .returning();
      if (!row) throw notFound("Categoria");
      return toView(row);
    });
  }
}
