import type { TransactionList, TransactionView } from "@norbius/contracts";
import { transactionInputSchema } from "@norbius/contracts";
import { withUserContext, type Database, type Transaction } from "@norbius/db";
import type { z } from "zod";
import type { AuditLogger } from "../../lib/audit";
import { badRequest, notFound } from "../../plugins/errors";
import type { AccountsRepository } from "../accounts/accounts.repository";
import { assertCategory } from "../categories/categories.service";
import type { ListFilters, TransactionsRepository } from "./transactions.repository";

type Input = z.infer<typeof transactionInputSchema>;
export type TransactionSource = "manual" | "ai" | "onboarding" | "import" | "system";

export class TransactionsService {
  constructor(
    private readonly db: Database,
    private readonly repo: TransactionsRepository,
    private readonly accounts: AccountsRepository,
    private readonly audit: AuditLogger,
  ) {}

  list(userId: string, filters: ListFilters): Promise<TransactionList> {
    return withUserContext(this.db, userId, async (tx) => {
      const r = await this.repo.list(tx, filters);
      return {
        items: r.items,
        total: r.total,
        page: filters.page,
        pageSize: filters.pageSize,
        totals: { incomeCents: r.incomeCents, expenseCents: r.expenseCents },
      };
    });
  }

  exportAll(userId: string, filters: ListFilters) {
    return withUserContext(this.db, userId, (tx) => this.repo.all(tx, filters));
  }

  async get(userId: string, id: string): Promise<TransactionView> {
    const view = await withUserContext(this.db, userId, (tx) => this.repo.view(tx, id));
    if (!view) throw notFound("Transação");
    return view;
  }

  /** Valida e normaliza a entrada; usado também por recorrências e onboarding. */
  async values(tx: Transaction, userId: string, input: Input) {
    const account = await this.accounts.findActive(tx, input.accountId);
    if (!account) throw badRequest("INVALID_ACCOUNT", "Conta não encontrada.");
    if (input.type === "transfer") {
      const destination = await this.accounts.findActive(tx, input.transferAccountId);
      if (!destination) throw badRequest("INVALID_ACCOUNT", "Conta de destino não encontrada.");
      return {
        userId,
        type: "transfer" as const,
        accountId: input.accountId,
        transferAccountId: input.transferAccountId,
        creditCardInvoiceId: null,
        categoryId: null,
        amountCents: input.amountCents,
        description: input.description || `Transferência para ${destination.name}`,
        date: input.date,
        paymentMethod: "transfer" as const,
        notes: input.notes,
      };
    }
    await assertCategory(tx, input.categoryId, input.type);
    return {
      userId,
      type: input.type,
      accountId: input.accountId,
      transferAccountId: null,
      creditCardInvoiceId: null,
      categoryId: input.categoryId,
      amountCents: input.amountCents,
      description: input.description,
      date: input.date,
      paymentMethod: input.paymentMethod ?? null,
      notes: input.notes,
    };
  }

  async createInTx(tx: Transaction, userId: string, input: Input, extra: { source?: TransactionSource; recurringTransactionId?: string } = {}) {
    const values = await this.values(tx, userId, input);
    return this.repo.insert(tx, {
      ...values,
      source: extra.source ?? "manual",
      recurring: Boolean(extra.recurringTransactionId),
      recurringTransactionId: extra.recurringTransactionId ?? null,
    });
  }

  async create(userId: string, input: Input, requestId: string, source: TransactionSource = "manual") {
    const id = await withUserContext(this.db, userId, (tx) => this.createInTx(tx, userId, input, { source }));
    await this.audit.record({ actorType: source === "ai" ? "ai" : "user", actorId: userId, subjectUserId: userId, action: "transaction.create", entityType: "transaction", entityId: id, requestId });
    return this.get(userId, id);
  }

  async update(userId: string, id: string, input: Input, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const current = await this.repo.find(tx, id);
      if (!current || current.deletedAt) throw notFound("Transação");
      if (current.creditCardInvoiceId) {
        throw badRequest("INVOICE_PAYMENT", "Pagamentos de fatura são gerenciados na tela do cartão.");
      }
      await this.repo.update(tx, id, await this.values(tx, userId, input));
    });
    await this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "transaction.update", entityType: "transaction", entityId: id, requestId });
    return this.get(userId, id);
  }

  /** Exclusão lógica: permite desfazer. */
  async remove(userId: string, id: string, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const current = await this.repo.find(tx, id);
      if (!current || current.deletedAt) throw notFound("Transação");
      await this.repo.update(tx, id, { deletedAt: new Date() });
    });
    await this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "transaction.delete", entityType: "transaction", entityId: id, requestId });
  }

  async restore(userId: string, id: string, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const current = await this.repo.find(tx, id);
      if (!current || !current.deletedAt) throw notFound("Transação");
      await this.repo.update(tx, id, { deletedAt: null });
    });
    await this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "transaction.restore", entityType: "transaction", entityId: id, requestId });
    return this.get(userId, id);
  }
}
