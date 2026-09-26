import type { TransactionView } from "@norbius/contracts";
import { transactionListQuerySchema } from "@norbius/contracts";
import { schema, type Transaction } from "@norbius/db";
import { monthRange } from "@norbius/domain";
import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

const t = schema.transactions;
const acc = schema.accounts;
const dest = alias(schema.accounts, "dest");
const cat = schema.categories;

export type ListFilters = z.infer<typeof transactionListQuerySchema>;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function whereFor(f: ListFilters, opts: { deleted?: boolean } = {}): SQL | undefined {
  const conds: (SQL | undefined)[] = [opts.deleted ? isNotNull(t.deletedAt) : isNull(t.deletedAt)];
  if (f.month) {
    const { start, end } = monthRange(f.month);
    conds.push(gte(t.date, start), lte(t.date, end));
  }
  if (f.from) conds.push(gte(t.date, f.from));
  if (f.to) conds.push(lte(t.date, f.to));
  if (f.type) conds.push(eq(t.type, f.type));
  if (f.accountId) conds.push(or(eq(t.accountId, f.accountId), eq(t.transferAccountId, f.accountId)));
  if (f.categoryId) conds.push(eq(t.categoryId, f.categoryId));
  if (f.q) conds.push(ilike(t.description, `%${escapeLike(f.q)}%`));
  return and(...conds);
}

const ORDER = {
  date_desc: [desc(t.date), desc(t.createdAt)],
  date_asc: [asc(t.date), asc(t.createdAt)],
  amount_desc: [desc(t.amountCents), desc(t.date)],
  amount_asc: [asc(t.amountCents), desc(t.date)],
} as const;

const viewColumns = {
  id: t.id,
  type: t.type,
  amountCents: t.amountCents,
  description: t.description,
  date: t.date,
  accountId: t.accountId,
  accountName: acc.name,
  transferAccountId: t.transferAccountId,
  transferAccountName: dest.name,
  categoryId: t.categoryId,
  categoryName: cat.name,
  creditCardInvoiceId: t.creditCardInvoiceId,
  paymentMethod: t.paymentMethod,
  notes: t.notes,
  source: t.source,
  recurringTransactionId: t.recurringTransactionId,
};

type ViewRow = { [K in keyof typeof viewColumns]: unknown } & Record<string, unknown>;

export function toTransactionView(r: ViewRow): TransactionView {
  return {
    id: r.id as string,
    type: r.type as TransactionView["type"],
    amountCents: r.amountCents as number,
    description: r.description as string,
    date: r.date as string,
    account: { id: r.accountId as string, name: r.accountName as string },
    transferAccount: r.transferAccountId ? { id: r.transferAccountId as string, name: r.transferAccountName as string } : null,
    category: r.categoryId ? { id: r.categoryId as string, name: r.categoryName as string } : null,
    creditCardInvoiceId: (r.creditCardInvoiceId as string | null) ?? null,
    paymentMethod: (r.paymentMethod as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    source: r.source as string,
    recurringTransactionId: (r.recurringTransactionId as string | null) ?? null,
  };
}

export class TransactionsRepository {
  private base(tx: Transaction) {
    return tx
      .select(viewColumns)
      .from(t)
      .innerJoin(acc, eq(acc.id, t.accountId))
      .leftJoin(dest, eq(dest.id, t.transferAccountId))
      .leftJoin(cat, eq(cat.id, t.categoryId));
  }

  async list(tx: Transaction, f: ListFilters) {
    const where = whereFor(f);
    const [items, [agg]] = await Promise.all([
      this.base(tx)
        .where(where)
        .orderBy(...ORDER[f.sort])
        .limit(f.pageSize)
        .offset((f.page - 1) * f.pageSize),
      tx
        .select({
          total: sql<number>`count(*)`.mapWith(Number),
          income: sql<number>`coalesce(sum(${t.amountCents}) filter (where ${t.type} = 'income'), 0)`.mapWith(Number),
          expense: sql<number>`coalesce(sum(${t.amountCents}) filter (where ${t.type} = 'expense'), 0)`.mapWith(Number),
        })
        .from(t)
        .where(where),
    ]);
    return { items: items.map(toTransactionView), total: agg!.total, incomeCents: agg!.income, expenseCents: agg!.expense };
  }

  /** Para exportação: sem paginação, com limite de segurança. */
  async all(tx: Transaction, f: ListFilters, limit = 10_000) {
    const rows = await this.base(tx).where(whereFor(f)).orderBy(...ORDER[f.sort]).limit(limit);
    return rows.map(toTransactionView);
  }

  async view(tx: Transaction, id: string, opts: { includeDeleted?: boolean } = {}) {
    const [row] = await this.base(tx).where(and(eq(t.id, id), opts.includeDeleted ? undefined : isNull(t.deletedAt)));
    return row ? toTransactionView(row) : null;
  }

  async find(tx: Transaction, id: string) {
    const [row] = await tx.select().from(t).where(eq(t.id, id));
    return row ?? null;
  }

  async insert(tx: Transaction, values: typeof t.$inferInsert) {
    const [row] = await tx.insert(t).values(values).returning({ id: t.id });
    return row!.id;
  }

  async update(tx: Transaction, id: string, values: Partial<typeof t.$inferInsert>) {
    const [row] = await tx.update(t).set(values).where(eq(t.id, id)).returning({ id: t.id });
    return row?.id ?? null;
  }
}
