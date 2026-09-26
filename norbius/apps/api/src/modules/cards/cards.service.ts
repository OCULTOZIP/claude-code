import type { CreditCardView, InvoiceItemView, InvoiceView } from "@norbius/contracts";
import { creditCardInputSchema, invoicePaymentSchema, purchaseInputSchema } from "@norbius/contracts";
import { withUserContext, type Database, type Transaction } from "@norbius/db";
import { invoiceForPurchase, invoiceStatus, planInstallments, splitInstallments } from "@norbius/domain";
import type { z } from "zod";
import type { AuditLogger } from "../../lib/audit";
import { userToday } from "../../lib/user-context";
import { badRequest, notFound } from "../../plugins/errors";
import type { AccountsRepository } from "../accounts/accounts.repository";
import { assertCategory } from "../categories/categories.service";
import type { TransactionsRepository } from "../transactions/transactions.repository";
import type { CardsRepository } from "./cards.repository";

type InvoiceRow = {
  id: string;
  creditCardId: string;
  referenceMonth: string;
  closingDate: string;
  dueDate: string;
  totalCents: number;
  paidCents: number;
};

export function toInvoiceView(r: InvoiceRow, today: string): InvoiceView {
  return {
    id: r.id,
    creditCardId: r.creditCardId,
    referenceMonth: r.referenceMonth.slice(0, 7),
    closingDate: r.closingDate,
    dueDate: r.dueDate,
    totalCents: r.totalCents,
    paidCents: r.paidCents,
    status: invoiceStatus({ ...r, today }),
  };
}

type PurchaseSource = "manual" | "ai" | "onboarding" | "system";

export class CardsService {
  constructor(
    private readonly db: Database,
    private readonly repo: CardsRepository,
    private readonly accounts: AccountsRepository,
    private readonly transactions: TransactionsRepository,
    private readonly audit: AuditLogger,
  ) {}

  private log(userId: string, action: string, entityType: string, entityId: string, requestId?: string) {
    return this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action, entityType, entityId, requestId: requestId ?? null });
  }

  async list(userId: string, includeArchived = false): Promise<CreditCardView[]> {
    return withUserContext(this.db, userId, async (tx) => {
      const today = await userToday(tx);
      const cards = await this.repo.listCards(tx, includeArchived);
      const used = await this.repo.usedLimit(tx, cards.map((c) => c.id));
      return Promise.all(
        cards.map(async (c) => {
          const period = invoiceForPurchase(today, c);
          const current = await this.repo.findInvoiceByMonth(tx, c.id, period.referenceMonth);
          const usedCents = used.get(c.id) ?? 0;
          return {
            id: c.id,
            name: c.name,
            brand: c.brand,
            lastFour: c.lastFour,
            limitCents: c.limitCents,
            usedLimitCents: usedCents,
            availableLimitCents: c.limitCents - usedCents,
            closingDay: c.closingDay,
            dueDay: c.dueDay,
            defaultPaymentAccountId: c.defaultPaymentAccountId,
            archived: c.archivedAt !== null,
            currentInvoice: current ? toInvoiceView(current, today) : null,
          };
        }),
      );
    });
  }

  async get(userId: string, id: string) {
    const card = (await this.list(userId, true)).find((c) => c.id === id);
    if (!card) throw notFound("Cartão");
    return card;
  }

  async createInTx(tx: Transaction, userId: string, input: z.infer<typeof creditCardInputSchema>, source: PurchaseSource = "manual") {
    if (input.defaultPaymentAccountId && !(await this.accounts.findActive(tx, input.defaultPaymentAccountId))) {
      throw badRequest("INVALID_ACCOUNT", "Conta de pagamento não encontrada.");
    }
    return this.repo.insertCard(tx, {
      userId,
      name: input.name,
      brand: input.brand,
      lastFour: input.lastFour ?? null,
      limitCents: input.limitCents,
      closingDay: input.closingDay,
      dueDay: input.dueDay,
      defaultPaymentAccountId: input.defaultPaymentAccountId ?? null,
      source,
    });
  }

  async create(userId: string, input: z.infer<typeof creditCardInputSchema>, requestId: string) {
    const row = await withUserContext(this.db, userId, (tx) => this.createInTx(tx, userId, input));
    await this.log(userId, "credit_card.create", "credit_card", row.id, requestId);
    return this.get(userId, row.id);
  }

  /** Mudança de fechamento/vencimento vale para faturas novas; as existentes mantêm as datas. */
  async update(userId: string, id: string, input: z.infer<typeof creditCardInputSchema>, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      if (input.defaultPaymentAccountId && !(await this.accounts.findActive(tx, input.defaultPaymentAccountId))) {
        throw badRequest("INVALID_ACCOUNT", "Conta de pagamento não encontrada.");
      }
      const row = await this.repo.updateCard(tx, id, {
        name: input.name,
        brand: input.brand,
        lastFour: input.lastFour ?? null,
        limitCents: input.limitCents,
        closingDay: input.closingDay,
        dueDay: input.dueDay,
        defaultPaymentAccountId: input.defaultPaymentAccountId ?? null,
      });
      if (!row) throw notFound("Cartão");
    });
    await this.log(userId, "credit_card.update", "credit_card", id, requestId);
    return this.get(userId, id);
  }

  async setArchived(userId: string, id: string, archived: boolean, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const row = await this.repo.updateCard(tx, id, { archivedAt: archived ? new Date() : null });
      if (!row) throw notFound("Cartão");
    });
    await this.log(userId, archived ? "credit_card.archive" : "credit_card.unarchive", "credit_card", id, requestId);
    return this.get(userId, id);
  }

  // ── Compras ───────────────────────────────────────────────
  private async plan(tx: Transaction, userId: string, purchaseId: string, input: z.infer<typeof purchaseInputSchema>) {
    const card = await this.repo.findCard(tx, input.creditCardId);
    if (!card || card.archivedAt) throw badRequest("INVALID_CARD", "Cartão não encontrado.");
    const plan = planInstallments(input.purchaseDate, splitInstallments(input.totalAmountCents, input.installmentCount), card);
    const rows = [];
    for (const item of plan) {
      const invoiceId = await this.repo.ensureInvoice(tx, userId, card.id, item.invoice);
      rows.push({
        userId,
        purchaseId,
        creditCardId: card.id,
        invoiceId,
        installmentNumber: item.installmentNumber,
        amountCents: item.amountCents,
        categoryId: input.categoryId,
        competenceDate: item.competenceDate,
      });
    }
    await this.repo.insertInstallments(tx, rows);
  }

  async createPurchaseInTx(
    tx: Transaction,
    userId: string,
    input: z.infer<typeof purchaseInputSchema>,
    extra: { source?: PurchaseSource; recurringTransactionId?: string } = {},
  ) {
    await assertCategory(tx, input.categoryId, "expense");
    const card = await this.repo.findCard(tx, input.creditCardId);
    if (!card || card.archivedAt) throw badRequest("INVALID_CARD", "Cartão não encontrado.");
    const purchase = await this.repo.insertPurchase(tx, {
      userId,
      creditCardId: input.creditCardId,
      description: input.description,
      totalAmountCents: input.totalAmountCents,
      installmentCount: input.installmentCount,
      purchaseDate: input.purchaseDate,
      categoryId: input.categoryId,
      notes: input.notes,
      source: extra.source ?? "manual",
      recurringTransactionId: extra.recurringTransactionId ?? null,
    });
    await this.plan(tx, userId, purchase.id, input);
    return purchase.id;
  }

  async createPurchase(userId: string, input: z.infer<typeof purchaseInputSchema>, requestId: string) {
    const id = await withUserContext(this.db, userId, (tx) => this.createPurchaseInTx(tx, userId, input));
    await this.log(userId, "credit_card_purchase.create", "credit_card_purchase", id, requestId);
    return this.getPurchase(userId, id);
  }

  async getPurchase(userId: string, id: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const row = await this.repo.findPurchase(tx, id);
      if (!row || row.deletedAt) throw notFound("Compra");
      return {
        id: row.id,
        creditCardId: row.creditCardId,
        description: row.description,
        totalAmountCents: row.totalAmountCents,
        installmentCount: row.installmentCount,
        purchaseDate: row.purchaseDate,
        categoryId: row.categoryId,
        notes: row.notes,
      };
    });
  }

  /** Edição recalcula todas as parcelas e suas faturas. */
  async updatePurchase(userId: string, id: string, input: z.infer<typeof purchaseInputSchema>, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const current = await this.repo.findPurchase(tx, id);
      if (!current || current.deletedAt) throw notFound("Compra");
      await assertCategory(tx, input.categoryId, "expense");
      await this.repo.deleteInstallments(tx, id);
      await this.repo.updatePurchase(tx, id, {
        creditCardId: input.creditCardId,
        description: input.description,
        totalAmountCents: input.totalAmountCents,
        installmentCount: input.installmentCount,
        purchaseDate: input.purchaseDate,
        categoryId: input.categoryId,
        notes: input.notes,
      });
      await this.plan(tx, userId, id, input);
    });
    await this.log(userId, "credit_card_purchase.update", "credit_card_purchase", id, requestId);
    return this.getPurchase(userId, id);
  }

  async setPurchaseDeleted(userId: string, id: string, deleted: boolean, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const current = await this.repo.findPurchase(tx, id);
      if (!current || Boolean(current.deletedAt) === deleted) throw notFound("Compra");
      await this.repo.updatePurchase(tx, id, { deletedAt: deleted ? new Date() : null });
    });
    await this.log(userId, deleted ? "credit_card_purchase.delete" : "credit_card_purchase.restore", "credit_card_purchase", id, requestId);
  }

  // ── Faturas ───────────────────────────────────────────────
  async listInvoices(userId: string, cardId: string) {
    return withUserContext(this.db, userId, async (tx) => {
      if (!(await this.repo.findCard(tx, cardId))) throw notFound("Cartão");
      const today = await userToday(tx);
      return (await this.repo.listInvoices(tx, cardId)).map((r) => toInvoiceView(r, today));
    });
  }

  async getInvoice(userId: string, invoiceId: string): Promise<{ invoice: InvoiceView; items: InvoiceItemView[] }> {
    return withUserContext(this.db, userId, async (tx) => {
      const row = await this.repo.findInvoice(tx, invoiceId);
      if (!row) throw notFound("Fatura");
      const items = await this.repo.invoiceItems(tx, invoiceId);
      return {
        invoice: toInvoiceView(row, await userToday(tx)),
        items: items.map((i) => ({
          id: i.id,
          purchaseId: i.purchaseId,
          description: i.description,
          category: { id: i.categoryId, name: i.categoryName },
          amountCents: i.amountCents,
          installmentNumber: i.installmentNumber,
          installmentCount: i.installmentCount,
          purchaseDate: i.purchaseDate,
        })),
      };
    });
  }

  /**
   * Pagamento de fatura = transferência da conta para o cartão. Reduz o saldo
   * da conta, mas não é despesa (as compras já foram contadas).
   */
  async payInvoice(userId: string, invoiceId: string, input: z.infer<typeof invoicePaymentSchema>, requestId: string) {
    const txId = await withUserContext(this.db, userId, async (tx) => {
      const invoice = await this.repo.findInvoice(tx, invoiceId);
      if (!invoice) throw notFound("Fatura");
      const remaining = invoice.totalCents - invoice.paidCents;
      if (remaining <= 0) throw badRequest("INVOICE_PAID", "Esta fatura já está paga.");
      if (input.amountCents > remaining) {
        throw badRequest("AMOUNT_EXCEEDS_INVOICE", "O valor é maior que o saldo em aberto da fatura.");
      }
      if (!(await this.accounts.findActive(tx, input.accountId))) throw badRequest("INVALID_ACCOUNT", "Conta não encontrada.");
      const card = await this.repo.findCard(tx, invoice.creditCardId);
      const [y, m] = invoice.referenceMonth.split("-");
      return this.transactions.insert(tx, {
        userId,
        type: "transfer",
        accountId: input.accountId,
        creditCardInvoiceId: invoiceId,
        amountCents: input.amountCents,
        description: `Fatura ${card!.name} ${m}/${y}`,
        date: input.date,
        paymentMethod: "credit_card_invoice",
      });
    });
    await this.log(userId, "credit_card_invoice.pay", "transaction", txId, requestId);
    return this.getInvoice(userId, invoiceId);
  }
}
