import type { RecurringView } from "@norbius/contracts";
import { recurringConfirmSchema, recurringInputSchema } from "@norbius/contracts";
import { schema, withUserContext, type Database, type Transaction } from "@norbius/db";
import { addDays, monthlyEquivalentCents, nextOccurrence, type RecurrenceRule } from "@norbius/domain";
import { asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { AuditLogger } from "../../lib/audit";
import { badRequest, notFound } from "../../plugins/errors";
import type { AccountsRepository } from "../accounts/accounts.repository";
import type { CardsRepository } from "../cards/cards.repository";
import type { CardsService } from "../cards/cards.service";
import { assertCategory } from "../categories/categories.service";
import type { TransactionsService } from "../transactions/transactions.service";

const r = schema.recurringTransactions;
const acc = schema.accounts;
const card = schema.creditCards;
const cat = alias(schema.categories, "cat");

type Row = typeof r.$inferSelect;

export function ruleOf(row: Pick<Row, "frequency" | "startDate" | "dayOfMonth" | "endDate">): RecurrenceRule {
  return { frequency: row.frequency, startDate: row.startDate, dayOfMonth: row.dayOfMonth, endDate: row.endDate };
}

/** Próxima ocorrência ainda não registrada nem pulada. */
export function pendingDate(row: Pick<Row, "frequency" | "startDate" | "dayOfMonth" | "endDate" | "lastHandledDate" | "active">) {
  if (!row.active) return null;
  return nextOccurrence(ruleOf(row), row.lastHandledDate ? addDays(row.lastHandledDate, 1) : row.startDate);
}

export class RecurringService {
  constructor(
    private readonly db: Database,
    private readonly accounts: AccountsRepository,
    private readonly cardsRepo: CardsRepository,
    private readonly transactions: TransactionsService,
    private readonly cards: CardsService,
    private readonly audit: AuditLogger,
  ) {}

  private log(userId: string, action: string, id: string, requestId?: string) {
    return this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action, entityType: "recurring_transaction", entityId: id, requestId: requestId ?? null });
  }

  async listInTx(tx: Transaction): Promise<RecurringView[]> {
    const rows = await tx
      .select({ rec: r, accountName: acc.name, cardName: card.name, categoryName: cat.name })
      .from(r)
      .leftJoin(acc, eq(acc.id, r.accountId))
      .leftJoin(card, eq(card.id, r.creditCardId))
      .innerJoin(cat, eq(cat.id, r.categoryId))
      .orderBy(desc(r.active), asc(r.type), asc(r.dayOfMonth), asc(r.description));
    return rows.map(({ rec, accountName, cardName, categoryName }) => ({
      id: rec.id,
      type: rec.type,
      description: rec.description,
      amountCents: rec.amountCents,
      amountIsEstimate: rec.amountIsEstimate,
      frequency: rec.frequency,
      dayOfMonth: rec.dayOfMonth,
      startDate: rec.startDate,
      endDate: rec.endDate,
      active: rec.active,
      account: rec.accountId ? { id: rec.accountId, name: accountName! } : null,
      creditCard: rec.creditCardId ? { id: rec.creditCardId, name: cardName! } : null,
      category: { id: rec.categoryId, name: categoryName },
      nextDate: pendingDate(rec),
      monthlyEquivalentCents: monthlyEquivalentCents(rec.amountCents, rec.frequency),
    }));
  }

  list(userId: string) {
    return withUserContext(this.db, userId, (tx) => this.listInTx(tx));
  }

  private async get(userId: string, id: string) {
    const found = (await this.list(userId)).find((x) => x.id === id);
    if (!found) throw notFound("Recorrência");
    return found;
  }

  private async validate(tx: Transaction, input: z.infer<typeof recurringInputSchema>) {
    await assertCategory(tx, input.categoryId, input.type);
    if (input.accountId && !(await this.accounts.findActive(tx, input.accountId))) {
      throw badRequest("INVALID_ACCOUNT", "Conta não encontrada.");
    }
    if (input.creditCardId) {
      const c = await this.cardsRepo.findCard(tx, input.creditCardId);
      if (!c || c.archivedAt) throw badRequest("INVALID_CARD", "Cartão não encontrado.");
    }
  }

  async createInTx(tx: Transaction, userId: string, input: z.infer<typeof recurringInputSchema>, source: "manual" | "onboarding" = "manual") {
    await this.validate(tx, input);
    const [row] = await tx
      .insert(r)
      .values({
        userId,
        type: input.type,
        accountId: input.accountId ?? null,
        creditCardId: input.creditCardId ?? null,
        amountCents: input.amountCents,
        amountIsEstimate: input.amountIsEstimate,
        categoryId: input.categoryId,
        description: input.description,
        frequency: input.frequency,
        dayOfMonth: input.dayOfMonth ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        source,
      })
      .returning({ id: r.id });
    return row!.id;
  }

  async create(userId: string, input: z.infer<typeof recurringInputSchema>, requestId: string) {
    const id = await withUserContext(this.db, userId, (tx) => this.createInTx(tx, userId, input));
    await this.log(userId, "recurring.create", id, requestId);
    return this.get(userId, id);
  }

  async update(userId: string, id: string, input: z.infer<typeof recurringInputSchema>, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      await this.validate(tx, input);
      const [row] = await tx
        .update(r)
        .set({
          type: input.type,
          accountId: input.accountId ?? null,
          creditCardId: input.creditCardId ?? null,
          amountCents: input.amountCents,
          amountIsEstimate: input.amountIsEstimate,
          categoryId: input.categoryId,
          description: input.description,
          frequency: input.frequency,
          dayOfMonth: input.dayOfMonth ?? null,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
        })
        .where(eq(r.id, id))
        .returning({ id: r.id });
      if (!row) throw notFound("Recorrência");
    });
    await this.log(userId, "recurring.update", id, requestId);
    return this.get(userId, id);
  }

  async setActive(userId: string, id: string, active: boolean, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx.update(r).set({ active }).where(eq(r.id, id)).returning({ id: r.id });
      if (!row) throw notFound("Recorrência");
    });
    await this.log(userId, active ? "recurring.activate" : "recurring.deactivate", id, requestId);
    return this.get(userId, id);
  }

  private async pending(tx: Transaction, id: string, date: string) {
    const [row] = await tx.select().from(r).where(eq(r.id, id));
    if (!row) throw notFound("Recorrência");
    const next = pendingDate(row);
    if (next !== date) {
      throw badRequest("NOT_PENDING", "Esta ocorrência não está pendente. Atualize a página e tente novamente.");
    }
    return row;
  }

  /**
   * Registra a ocorrência pendente como movimentação real (conta ou cartão).
   * O valor pode diferir do previsto (ex.: conta de luz).
   */
  async confirm(userId: string, id: string, input: z.infer<typeof recurringConfirmSchema>, requestId: string) {
    const created = await withUserContext(this.db, userId, async (tx) => {
      const row = await this.pending(tx, id, input.date);
      const amountCents = input.amountCents ?? row.amountCents;
      let entityId: string;
      if (row.creditCardId) {
        entityId = await this.cards.createPurchaseInTx(
          tx,
          userId,
          {
            creditCardId: row.creditCardId,
            description: row.description,
            totalAmountCents: amountCents,
            installmentCount: 1,
            purchaseDate: input.date,
            categoryId: row.categoryId,
            notes: null,
          },
          { recurringTransactionId: row.id },
        );
      } else {
        entityId = await this.transactions.createInTx(
          tx,
          userId,
          {
            type: row.type,
            accountId: row.accountId!,
            amountCents,
            categoryId: row.categoryId,
            description: row.description,
            date: input.date,
            paymentMethod: null,
            notes: null,
          },
          { recurringTransactionId: row.id },
        );
      }
      await tx.update(r).set({ lastHandledDate: input.date }).where(eq(r.id, id));
      return { kind: row.creditCardId ? ("card_purchase" as const) : ("transaction" as const), id: entityId };
    });
    await this.log(userId, "recurring.confirm", id, requestId);
    return { created, recurring: await this.get(userId, id) };
  }

  /** Pula a ocorrência pendente sem registrar movimentação. */
  async skip(userId: string, id: string, date: string, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      await this.pending(tx, id, date);
      await tx.update(r).set({ lastHandledDate: date }).where(eq(r.id, id));
    });
    await this.log(userId, "recurring.skip", id, requestId);
    return this.get(userId, id);
  }
}
