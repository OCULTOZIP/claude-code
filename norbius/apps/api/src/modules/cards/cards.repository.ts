import { qualified as q, schema, type Transaction } from "@norbius/db";
import type { InvoicePeriod } from "@norbius/domain";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

const card = schema.creditCards;
const inv = schema.creditCardInvoices;
const p = schema.creditCardPurchases;
const ct = schema.creditCardTransactions;
const t = schema.transactions;
const cat = schema.categories;

/** Soma das parcelas (de compras não excluídas) por fatura. */
const invoiceTotal = sql<number>`coalesce((
  select sum(${q(ct.amountCents)}) from ${ct}
  join ${p} on ${q(p.id)} = ${q(ct.purchaseId)}
  where ${q(ct.invoiceId)} = ${q(inv.id)} and ${q(p.deletedAt)} is null
), 0)::bigint`.mapWith(Number);

/** Pagamentos (transferências não excluídas) vinculados à fatura. */
const invoicePaid = sql<number>`coalesce((
  select sum(${q(t.amountCents)}) from ${t}
  where ${q(t.creditCardInvoiceId)} = ${q(inv.id)} and ${q(t.deletedAt)} is null
), 0)::bigint`.mapWith(Number);

export class CardsRepository {
  listCards(tx: Transaction, includeArchived: boolean) {
    return tx
      .select()
      .from(card)
      .where(includeArchived ? undefined : isNull(card.archivedAt))
      .orderBy(asc(card.createdAt));
  }

  async findCard(tx: Transaction, id: string) {
    const [row] = await tx.select().from(card).where(eq(card.id, id));
    return row ?? null;
  }

  async insertCard(tx: Transaction, values: typeof card.$inferInsert) {
    const [row] = await tx.insert(card).values(values).returning();
    return row!;
  }

  async updateCard(tx: Transaction, id: string, values: Partial<typeof card.$inferInsert>) {
    const [row] = await tx.update(card).set(values).where(eq(card.id, id)).returning();
    return row ?? null;
  }

  /**
   * Limite usado = parcelas de compras ativas − pagamentos de faturas do cartão.
   * Parcelas futuras também ocupam o limite, como nos emissores brasileiros.
   */
  async usedLimit(tx: Transaction, cardIds: string[]) {
    if (cardIds.length === 0) return new Map<string, number>();
    const rows = await tx
      .select({
        cardId: card.id,
        installments: sql<number>`coalesce((
          select sum(${q(ct.amountCents)}) from ${ct} join ${p} on ${q(p.id)} = ${q(ct.purchaseId)}
          where ${q(ct.creditCardId)} = ${q(card.id)} and ${q(p.deletedAt)} is null), 0)::bigint`.mapWith(Number),
        payments: sql<number>`coalesce((
          select sum(${q(t.amountCents)}) from ${t} join ${inv} on ${q(inv.id)} = ${q(t.creditCardInvoiceId)}
          where ${q(inv.creditCardId)} = ${q(card.id)} and ${q(t.deletedAt)} is null), 0)::bigint`.mapWith(Number),
      })
      .from(card)
      .where(inArray(card.id, cardIds));
    return new Map(rows.map((r) => [r.cardId, Math.max(0, r.installments - r.payments)]));
  }

  listInvoices(tx: Transaction, cardId: string) {
    return tx
      .select({
        id: inv.id,
        creditCardId: inv.creditCardId,
        referenceMonth: inv.referenceMonth,
        closingDate: inv.closingDate,
        dueDate: inv.dueDate,
        totalCents: invoiceTotal,
        paidCents: invoicePaid,
      })
      .from(inv)
      .where(eq(inv.creditCardId, cardId))
      .orderBy(desc(inv.referenceMonth));
  }

  /** Todas as faturas de todos os cartões com totais (para painel e compromissos). */
  listAllInvoices(tx: Transaction) {
    return tx
      .select({
        id: inv.id,
        creditCardId: inv.creditCardId,
        cardName: card.name,
        referenceMonth: inv.referenceMonth,
        closingDate: inv.closingDate,
        dueDate: inv.dueDate,
        totalCents: invoiceTotal,
        paidCents: invoicePaid,
      })
      .from(inv)
      .innerJoin(card, eq(card.id, inv.creditCardId))
      .where(isNull(card.archivedAt));
  }

  async findInvoice(tx: Transaction, id: string) {
    const [row] = await tx
      .select({
        id: inv.id,
        creditCardId: inv.creditCardId,
        referenceMonth: inv.referenceMonth,
        closingDate: inv.closingDate,
        dueDate: inv.dueDate,
        totalCents: invoiceTotal,
        paidCents: invoicePaid,
      })
      .from(inv)
      .where(eq(inv.id, id));
    return row ?? null;
  }

  async findInvoiceByMonth(tx: Transaction, cardId: string, referenceMonth: string) {
    const [row] = await tx
      .select({ id: inv.id })
      .from(inv)
      .where(and(eq(inv.creditCardId, cardId), eq(inv.referenceMonth, `${referenceMonth}-01`)));
    return row ? this.findInvoice(tx, row.id) : null;
  }

  /** Garante a fatura do mês (cria se não existir) e retorna o id. */
  async ensureInvoice(tx: Transaction, userId: string, cardId: string, period: InvoicePeriod) {
    const referenceMonth = `${period.referenceMonth}-01`;
    await tx
      .insert(inv)
      .values({ userId, creditCardId: cardId, referenceMonth, closingDate: period.closingDate, dueDate: period.dueDate })
      .onConflictDoNothing({ target: [inv.creditCardId, inv.referenceMonth] });
    const [row] = await tx
      .select({ id: inv.id })
      .from(inv)
      .where(and(eq(inv.creditCardId, cardId), eq(inv.referenceMonth, referenceMonth)));
    return row!.id;
  }

  invoiceItems(tx: Transaction, invoiceId: string) {
    return tx
      .select({
        id: ct.id,
        purchaseId: ct.purchaseId,
        description: p.description,
        categoryId: cat.id,
        categoryName: cat.name,
        amountCents: ct.amountCents,
        installmentNumber: ct.installmentNumber,
        installmentCount: p.installmentCount,
        purchaseDate: p.purchaseDate,
      })
      .from(ct)
      .innerJoin(p, eq(p.id, ct.purchaseId))
      .innerJoin(cat, eq(cat.id, ct.categoryId))
      .where(and(eq(ct.invoiceId, invoiceId), isNull(p.deletedAt)))
      .orderBy(desc(p.purchaseDate), desc(p.createdAt));
  }

  async findPurchase(tx: Transaction, id: string) {
    const [row] = await tx.select().from(p).where(eq(p.id, id));
    return row ?? null;
  }

  async insertPurchase(tx: Transaction, values: typeof p.$inferInsert) {
    const [row] = await tx.insert(p).values(values).returning();
    return row!;
  }

  async updatePurchase(tx: Transaction, id: string, values: Partial<typeof p.$inferInsert>) {
    const [row] = await tx.update(p).set(values).where(eq(p.id, id)).returning();
    return row ?? null;
  }

  deleteInstallments(tx: Transaction, purchaseId: string) {
    return tx.delete(ct).where(eq(ct.purchaseId, purchaseId));
  }

  insertInstallments(tx: Transaction, rows: (typeof ct.$inferInsert)[]) {
    return tx.insert(ct).values(rows);
  }
}
