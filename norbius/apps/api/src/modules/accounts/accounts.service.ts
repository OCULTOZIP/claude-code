import type { AccountView } from "@norbius/contracts";
import { accountInputSchema } from "@norbius/contracts";
import { withUserContext, type Database } from "@norbius/db";
import type { z } from "zod";
import type { AuditLogger } from "../../lib/audit";
import { userToday } from "../../lib/user-context";
import { notFound } from "../../plugins/errors";
import type { AccountsRepository } from "./accounts.repository";

type Row = Awaited<ReturnType<AccountsRepository["list"]>>[number];

export function toAccountView(r: Row): AccountView {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    institutionName: r.institutionName,
    initialBalanceCents: r.initialBalanceCents,
    initialBalanceDate: r.initialBalanceDate,
    includeInAvailableBalance: r.includeInAvailableBalance,
    archived: r.archivedAt !== null,
    balanceCents: r.balanceCents,
  };
}

export class AccountsService {
  constructor(
    private readonly db: Database,
    private readonly repo: AccountsRepository,
    private readonly audit: AuditLogger,
  ) {}

  list(userId: string, includeArchived = false) {
    return withUserContext(this.db, userId, async (tx) =>
      (await this.repo.list(tx, await userToday(tx), { includeArchived })).map(toAccountView),
    );
  }

  private async view(userId: string, id: string) {
    const all = await this.list(userId, true);
    const found = all.find((x) => x.id === id);
    if (!found) throw notFound("Conta");
    return found;
  }

  async create(userId: string, input: z.infer<typeof accountInputSchema>, requestId: string) {
    const id = await withUserContext(this.db, userId, async (tx) => {
      const today = await userToday(tx);
      const row = await this.repo.insert(tx, {
        userId,
        name: input.name,
        type: input.type,
        institutionName: input.institutionName,
        initialBalanceCents: input.initialBalanceCents,
        initialBalanceDate: input.initialBalanceDate ?? today,
        includeInAvailableBalance: input.includeInAvailableBalance ?? input.type !== "investment",
      });
      return row.id;
    });
    await this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "account.create", entityType: "account", entityId: id, requestId });
    return this.view(userId, id);
  }

  async update(userId: string, id: string, input: z.infer<typeof accountInputSchema>, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const current = await this.repo.find(tx, id);
      if (!current) throw notFound("Conta");
      await this.repo.update(tx, id, {
        name: input.name,
        type: input.type,
        institutionName: input.institutionName,
        initialBalanceCents: input.initialBalanceCents,
        initialBalanceDate: input.initialBalanceDate ?? current.initialBalanceDate,
        includeInAvailableBalance: input.includeInAvailableBalance ?? current.includeInAvailableBalance,
      });
    });
    await this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "account.update", entityType: "account", entityId: id, requestId });
    return this.view(userId, id);
  }

  /** Contas com histórico não são apagadas: são arquivadas (e podem ser reativadas). */
  async setArchived(userId: string, id: string, archived: boolean, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const row = await this.repo.update(tx, id, { archivedAt: archived ? new Date() : null });
      if (!row) throw notFound("Conta");
    });
    await this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: archived ? "account.archive" : "account.unarchive", entityType: "account", entityId: id, requestId });
    return this.view(userId, id);
  }
}
