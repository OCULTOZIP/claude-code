import type { ContributionView, GoalView } from "@norbius/contracts";
import { contributionInputSchema, goalInputSchema } from "@norbius/contracts";
import { qualified as q, schema, withUserContext, type Database, type Transaction } from "@norbius/db";
import { diffDays } from "@norbius/domain";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { AuditLogger } from "../../lib/audit";
import { userToday } from "../../lib/user-context";
import { notFound } from "../../plugins/errors";

const g = schema.goals;
const gc = schema.goalContributions;

const current = sql<number>`coalesce((select sum(${q(gc.amountCents)}) from ${gc} where ${q(gc.goalId)} = ${q(g.id)}), 0)::bigint`.mapWith(Number);

/** Aporte mensal necessário até o prazo (estimativa linear; meses restantes arredondados para cima). */
export function monthlyNeeded(remainingCents: number, targetDate: string | null, today: string): number | null {
  if (!targetDate || remainingCents <= 0) return null;
  const days = diffDays(targetDate, today);
  const months = Math.max(1, Math.ceil(days / 30.4375));
  return Math.ceil(remainingCents / months);
}

export class GoalsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditLogger,
  ) {}

  private log(userId: string, action: string, id: string, requestId?: string) {
    return this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action, entityType: "goal", entityId: id, requestId: requestId ?? null });
  }

  async listInTx(tx: Transaction, includeArchived = false): Promise<GoalView[]> {
    const today = await userToday(tx);
    const rows = await tx
      .select({ goal: g, current })
      .from(g)
      .where(includeArchived ? undefined : sql`${g.status} <> 'archived'`)
      .orderBy(asc(sql`case ${g.status} when 'active' then 0 when 'completed' then 1 else 2 end`), asc(g.createdAt));
    return rows.map(({ goal, current: cur }) => ({
      id: goal.id,
      name: goal.name,
      targetAmountCents: goal.targetAmountCents,
      currentAmountCents: cur,
      progress: Math.max(0, Math.min(1, cur / goal.targetAmountCents)),
      targetDate: goal.targetDate,
      status: goal.status,
      monthlyNeededCents: goal.status === "active" ? monthlyNeeded(goal.targetAmountCents - cur, goal.targetDate, today) : null,
    }));
  }

  list(userId: string, includeArchived = false) {
    return withUserContext(this.db, userId, (tx) => this.listInTx(tx, includeArchived));
  }

  async get(userId: string, id: string) {
    const found = (await this.list(userId, true)).find((x) => x.id === id);
    if (!found) throw notFound("Meta");
    return found;
  }

  async createInTx(tx: Transaction, userId: string, input: z.infer<typeof goalInputSchema>, source: "manual" | "onboarding" | "ai" = "manual") {
    const [row] = await tx
      .insert(g)
      .values({ userId, name: input.name, targetAmountCents: input.targetAmountCents, targetDate: input.targetDate ?? null, source })
      .returning({ id: g.id });
    return row!.id;
  }

  async create(userId: string, input: z.infer<typeof goalInputSchema>, requestId: string) {
    const id = await withUserContext(this.db, userId, (tx) => this.createInTx(tx, userId, input));
    await this.log(userId, "goal.create", id, requestId);
    return this.get(userId, id);
  }

  async update(userId: string, id: string, input: z.infer<typeof goalInputSchema>, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(g)
        .set({ name: input.name, targetAmountCents: input.targetAmountCents, targetDate: input.targetDate ?? null })
        .where(eq(g.id, id))
        .returning({ id: g.id });
      if (!row) throw notFound("Meta");
      await this.syncStatus(tx, id);
    });
    await this.log(userId, "goal.update", id, requestId);
    return this.get(userId, id);
  }

  async setArchived(userId: string, id: string, archived: boolean, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx.update(g).set({ status: archived ? "archived" : "active" }).where(eq(g.id, id)).returning({ id: g.id });
      if (!row) throw notFound("Meta");
      if (!archived) await this.syncStatus(tx, id);
    });
    await this.log(userId, archived ? "goal.archive" : "goal.unarchive", id, requestId);
    return this.get(userId, id);
  }

  /** Concluída quando os aportes alcançam o alvo; volta a ativa se cair abaixo. */
  private async syncStatus(tx: Transaction, id: string) {
    const [row] = await tx.select({ goal: g, current }).from(g).where(eq(g.id, id));
    if (!row || row.goal.status === "archived") return;
    const reached = row.current >= row.goal.targetAmountCents;
    if (reached && row.goal.status !== "completed") {
      await tx.update(g).set({ status: "completed", completedAt: new Date() }).where(eq(g.id, id));
    } else if (!reached && row.goal.status === "completed") {
      await tx.update(g).set({ status: "active", completedAt: null }).where(eq(g.id, id));
    }
  }

  async contributions(userId: string, goalId: string): Promise<ContributionView[]> {
    return withUserContext(this.db, userId, async (tx) => {
      const [goal] = await tx.select({ id: g.id }).from(g).where(eq(g.id, goalId));
      if (!goal) throw notFound("Meta");
      const rows = await tx.select().from(gc).where(eq(gc.goalId, goalId)).orderBy(desc(gc.date), desc(gc.createdAt));
      return rows.map((c) => ({ id: c.id, amountCents: c.amountCents, date: c.date, note: c.note }));
    });
  }

  async contribute(userId: string, goalId: string, input: z.infer<typeof contributionInputSchema>, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const [goal] = await tx.select({ id: g.id }).from(g).where(eq(g.id, goalId));
      if (!goal) throw notFound("Meta");
      await tx.insert(gc).values({ userId, goalId, amountCents: input.amountCents, date: input.date, note: input.note });
      await this.syncStatus(tx, goalId);
    });
    await this.log(userId, "goal.contribution", goalId, requestId);
    return this.get(userId, goalId);
  }

  async removeContribution(userId: string, goalId: string, contributionId: string, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx.delete(gc).where(sql`${gc.id} = ${contributionId} and ${gc.goalId} = ${goalId}`).returning({ id: gc.id });
      if (!row) throw notFound("Aporte");
      await this.syncStatus(tx, goalId);
    });
    await this.log(userId, "goal.contribution_delete", goalId, requestId);
    return this.get(userId, goalId);
  }
}
