import { qualified, schema, type Transaction } from "@norbius/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

const a = schema.accounts;
const t = schema.transactions;

/**
 * Saldo = saldo inicial + movimentações a partir da data do saldo inicial até
 * hoje (inclusive). Lançamentos com data futura não afetam o saldo atual.
 * Pagamento de fatura é transferência para o cartão: reduz o saldo da conta.
 */
export function balanceExpr(today: string) {
  const accountId = qualified(a.id);
  return sql<number>`(${qualified(a.initialBalanceCents)} + coalesce((
    select sum(case
      when ${qualified(t.accountId)} = ${accountId} then case when ${t.type} = 'income' then ${t.amountCents} else -${t.amountCents} end
      else ${t.amountCents}
    end)
    from ${t}
    where ${t.deletedAt} is null
      and ${t.date} <= ${today}
      and ${qualified(t.date)} >= ${qualified(a.initialBalanceDate)}
      and (${qualified(t.accountId)} = ${accountId} or ${qualified(t.transferAccountId)} = ${accountId})
  ), 0))::bigint`.mapWith(Number);
}

export class AccountsRepository {
  list(tx: Transaction, today: string, opts: { includeArchived?: boolean } = {}) {
    return tx
      .select({
        id: a.id,
        name: a.name,
        type: a.type,
        institutionName: a.institutionName,
        initialBalanceCents: a.initialBalanceCents,
        initialBalanceDate: a.initialBalanceDate,
        includeInAvailableBalance: a.includeInAvailableBalance,
        archivedAt: a.archivedAt,
        balanceCents: balanceExpr(today),
      })
      .from(a)
      .where(opts.includeArchived ? undefined : isNull(a.archivedAt))
      .orderBy(asc(a.createdAt));
  }

  async find(tx: Transaction, id: string) {
    const [row] = await tx.select().from(a).where(eq(a.id, id));
    return row ?? null;
  }

  async findActive(tx: Transaction, id: string) {
    const [row] = await tx.select().from(a).where(and(eq(a.id, id), isNull(a.archivedAt)));
    return row ?? null;
  }

  async insert(tx: Transaction, values: typeof a.$inferInsert) {
    const [row] = await tx.insert(a).values(values).returning();
    return row!;
  }

  async update(tx: Transaction, id: string, values: Partial<typeof a.$inferInsert>) {
    const [row] = await tx.update(a).set(values).where(eq(a.id, id)).returning();
    return row ?? null;
  }
}
