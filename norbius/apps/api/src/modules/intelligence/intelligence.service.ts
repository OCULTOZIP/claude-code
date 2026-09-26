import type { InsightView, IntelligenceSummary } from "@norbius/contracts";
import { qualified as q, schema, withUserContext, type Database, type Transaction } from "@norbius/db";
import { addDays, todayIn } from "@norbius/domain";
import {
  coreState,
  detectInsights,
  EVENT_INSIGHT_TYPES,
  hash32,
  MIN_HISTORY_DAYS,
  project,
  safeToSpend,
  type DetectorInput,
  type InsightCandidate,
  type InsightType,
  type CoreState,
  type KnownEvent,
  type Projection,
} from "@norbius/intelligence";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { notFound } from "../../plugins/errors";
import { userTimezone } from "../../lib/user-context";
import type { AccountsRepository } from "../accounts/accounts.repository";
import type { BillingService } from "../billing/billing.service";
import type { CardsService } from "../cards/cards.service";
import type { DashboardService } from "../dashboard/dashboard.service";
import type { GoalsService } from "../goals/goals.service";
import type { NewInsight, NotificationsService } from "../notifications/notifications.service";

const ins = schema.insights;
const snap = schema.projectionSnapshots;
const coreEv = schema.coreStateEvents;
const t = schema.transactions;
const p = schema.creditCardPurchases;
const cat = schema.categories;
const rec = schema.recurringTransactions;
const gc = schema.goalContributions;
const goalsT = schema.goals;

/** Horizonte da projeção e dos compromissos considerados. */
const HORIZON_DAYS = 30;
const HISTORY_WINDOW = 120;
const SNAPSHOT_RETENTION_DAYS = 35;

type Loaded = {
  today: string;
  plan: "free" | "pro";
  hasAccounts: boolean;
  historyDays: number;
  incomeRegular: boolean;
  events: KnownEvent[];
  variableSpending: { date: string; cents: number }[];
  detector: Omit<DetectorInput, "projection">;
  goalsMonthlyCents: number;
};

/**
 * Inteligência financeira (Fase 4, ADR 0005). Roda sob demanda: carrega os
 * dados do usuário, projeta o saldo, executa os detectores e sincroniza os
 * insights (novos abrem, os que deixaram de valer são resolvidos). Tudo na
 * mesma transação, com RLS.
 */
export class IntelligenceService {
  constructor(
    private readonly db: Database,
    private readonly accounts: AccountsRepository,
    private readonly cards: CardsService,
    private readonly goals: GoalsService,
    private readonly dashboard: DashboardService,
    private readonly billing: BillingService,
    private readonly notifications: NotificationsService,
  ) {}

  /** `now` só muda nos testes e no job (instante de referência da análise). */
  async summary(userId: string, now = new Date()): Promise<IntelligenceSummary> {
    const cards = await this.cards.list(userId);
    return withUserContext(this.db, userId, async (tx) => {
      const data = await this.load(tx, cards, now);
      const projection =
        data.hasAccounts && data.historyDays >= MIN_HISTORY_DAYS
          ? project({
              today: data.today,
              horizonEnd: addDays(data.today, HORIZON_DAYS),
              balanceCents: data.detector.balanceCents,
              events: data.events,
              variableSpending: data.variableSpending,
              historyDays: data.historyDays,
              incomeRegular: data.incomeRegular,
            })
          : null;
      const candidates = detectInsights({ ...data.detector, projection }, data.plan);
      const opened = await this.sync(tx, userId, candidates, now);
      await this.notifications.fromInsights(tx, userId, opened, now);
      await this.saveSnapshot(tx, userId, projection);

      const open = await this.openInsights(tx);
      const core = coreState({
        hasAccounts: data.hasAccounts,
        historyDays: data.historyDays,
        insights: open.map((i) => ({ id: i.id, type: i.type as InsightType, severity: i.severity, title: i.title })),
        projection,
      });
      await this.recordCore(tx, userId, core.state, core.reasons);

      const sts =
        data.hasAccounts && data.historyDays >= MIN_HISTORY_DAYS
          ? safeToSpend({
              today: data.today,
              balanceCents: data.detector.balanceCents,
              events: data.events,
              goalsMonthlyCents: data.goalsMonthlyCents,
              avgMonthlyIncomeCents: data.detector.avgMonthlyIncomeCents,
              dailyVariableCents: projection?.dailyVariableCents ?? 0,
              confidence: projection?.confidence ?? "low",
            })
          : null;

      return {
        today: data.today,
        historyDays: data.historyDays,
        minHistoryDays: MIN_HISTORY_DAYS,
        core,
        insights: open,
        projection: projection
          ? {
              kind: "estimate",
              confidence: projection.confidence,
              horizonEnd: projection.horizonEnd,
              days: projection.days,
              lowest: projection.lowestP50,
              endCents: projection.endP50,
              dailyVariableCents: projection.dailyVariableCents,
              assumptions: projection.assumptions,
            }
          : null,
        projectionUnavailable: projection
          ? null
          : !data.hasAccounts
            ? "Cadastre suas contas para o NORBIUS projetar o saldo."
            : `Preciso de pelo menos ${MIN_HISTORY_DAYS} dias de registros para projetar o saldo (hoje: ${data.historyDays}).`,
        safeToSpend: sts
          ? {
              kind: "estimate",
              until: sts.until,
              basis: sts.basis,
              days: sts.days,
              availableCents: sts.availableCents,
              perDayCents: sts.perDayCents,
              perWeekCents: sts.perWeekCents,
              confidence: sts.confidence,
              assumptions: sts.assumptions,
            }
          : null,
      };
    });
  }

  async dismiss(userId: string, id: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(ins)
        .set({ status: "dismissed" })
        .where(and(eq(ins.id, id), inArray(ins.status, ["open", "seen"])))
        .returning({ id: ins.id });
      if (!row) throw notFound("Alerta");
    });
  }

  private async openInsights(tx: Transaction): Promise<InsightView[]> {
    const rows = await tx
      .select()
      .from(ins)
      .where(inArray(ins.status, ["open", "seen"]))
      .orderBy(sql`case ${ins.severity} when 'critical' then 0 when 'attention' then 1 when 'opportunity' then 2 else 3 end`, desc(ins.createdAt));
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      title: r.title,
      body: r.body,
      status: r.status as "open" | "seen",
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Novos candidatos abrem; os existentes são atualizados (dispensados
   * continuam dispensados); os de condição que sumiram viram "resolved" e os de
   * evento vencidos, "expired".
   */
  private async sync(tx: Transaction, userId: string, candidates: InsightCandidate[], now: Date): Promise<NewInsight[]> {
    // Só o que nunca existiu gera aviso (reabrir o mesmo fingerprint não notifica de novo).
    const known = new Set(
      candidates.length
        ? (
            await tx
              .select({ fingerprint: ins.fingerprint })
              .from(ins)
              .where(inArray(ins.fingerprint, candidates.map((c) => c.fingerprint)))
          ).map((r) => r.fingerprint)
        : [],
    );
    const opened: NewInsight[] = [];
    for (const c of candidates) {
      const values = {
        severity: c.severity,
        title: c.title.slice(0, 200),
        body: c.body.slice(0, 1000),
        evidence: c.evidence,
        periodStart: c.periodStart ?? null,
        periodEnd: c.periodEnd ?? null,
        expiresAt: c.expiresOn ? new Date(`${c.expiresOn}T23:59:59Z`) : null,
      };
      const [row] = await tx
        .insert(ins)
        .values({ userId, type: c.type, fingerprint: c.fingerprint, ...values })
        .onConflictDoUpdate({
          target: [ins.userId, ins.fingerprint],
          set: { ...values, status: sql`case when ${ins.status} in ('resolved','expired') then 'open' else ${ins.status} end` },
        })
        .returning({ id: ins.id });
      if (!known.has(c.fingerprint)) opened.push({ id: row!.id, type: c.type, severity: c.severity, title: values.title, body: values.body, fingerprint: c.fingerprint });
    }
    const current = candidates.map((c) => c.fingerprint);
    const events = [...EVENT_INSIGHT_TYPES] as string[];
    await tx
      .update(ins)
      .set({ status: "resolved" })
      .where(
        and(
          inArray(ins.status, ["open", "seen"]),
          sql`${ins.type} <> all(${sql.param(events)}::text[])`,
          current.length ? sql`${ins.fingerprint} <> all(${sql.param(current)}::text[])` : sql`true`,
        ),
      );
    await tx
      .update(ins)
      .set({ status: "expired" })
      .where(and(inArray(ins.status, ["open", "seen"]), lt(ins.expiresAt, now)));
    return opened;
  }

  /** Guarda a projeção só quando a entrada mudou; poda o histórico antigo. */
  private async saveSnapshot(tx: Transaction, userId: string, projection: Projection | null) {
    if (!projection) return;
    const inputsHash = hash32(JSON.stringify([projection.today, projection.days, projection.assumptions])).toString(16);
    const [last] = await tx.select({ hash: snap.inputsHash }).from(snap).orderBy(desc(snap.generatedAt)).limit(1);
    if (last?.hash === inputsHash) return;
    await tx.insert(snap).values({
      userId,
      horizonEnd: projection.horizonEnd,
      inputsHash,
      methodVersion: projection.methodVersion,
      confidence: projection.confidence,
      result: { days: projection.days, assumptions: projection.assumptions, dailyVariableCents: projection.dailyVariableCents },
    });
    await tx.delete(snap).where(lt(snap.generatedAt, new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 86_400_000)));
  }

  /** Histórico do CORE: registra só mudanças de estado ou de motivos. */
  private async recordCore(tx: Transaction, userId: string, state: CoreState, reasons: { insightId: string; type: string }[]) {
    const [last] = await tx.select().from(coreEv).orderBy(desc(coreEv.createdAt)).limit(1);
    if (last && last.state === state && JSON.stringify(last.reasons) === JSON.stringify(reasons)) return;
    await tx.insert(coreEv).values({ userId, state, reasons });
  }

  private async load(tx: Transaction, cards: Awaited<ReturnType<CardsService["list"]>>, now: Date): Promise<Loaded> {
    const tz = await userTimezone(tx);
    const today = todayIn(tz, now);
    const since = addDays(today, -HISTORY_WINDOW);
    const plan = (await this.billing.entitlementsInTx(tx)).plan;

    const accounts = await this.accounts.list(tx, today);
    const balanceCents = accounts.filter((a) => a.includeInAvailableBalance).reduce((s, a) => s + a.balanceCents, 0);
    const historyDays = await this.dashboard.historyDays(tx, today);
    const [profile] = await tx
      .select({ income: schema.profiles.avgMonthlyIncomeCents, frequency: schema.profiles.incomeFrequency })
      .from(schema.profiles)
      .limit(1);

    const commitments = await this.dashboard.commitments(tx, today, HORIZON_DAYS, 500);
    const events: KnownEvent[] = commitments.map((c) => ({
      date: c.date,
      amountCents: c.direction === "in" ? c.amountCents : -c.amountCents,
      label: c.description,
      kind: c.kind,
      isEstimate: c.isEstimate,
    }));

    const accountExpenses = await tx
      .select({
        id: t.id,
        date: t.date,
        cents: t.amountCents,
        categoryId: t.categoryId,
        categoryName: cat.name,
        categoryKey: cat.systemKey,
        description: t.description,
        recurringId: t.recurringTransactionId,
      })
      .from(t)
      .leftJoin(cat, eq(cat.id, t.categoryId))
      .where(and(isNull(t.deletedAt), eq(t.type, "expense"), gte(t.date, since), sql`${t.date} <= ${today}`));
    const cardPurchases = await tx
      .select({
        id: p.id,
        date: p.purchaseDate,
        cents: p.totalAmountCents,
        categoryId: p.categoryId,
        categoryName: cat.name,
        categoryKey: cat.systemKey,
        description: p.description,
        recurringId: p.recurringTransactionId,
      })
      .from(p)
      .innerJoin(cat, eq(cat.id, p.categoryId))
      .where(and(isNull(p.deletedAt), gte(p.purchaseDate, since), sql`${p.purchaseDate} <= ${today}`));
    const expenses = [...accountExpenses, ...cardPurchases].map((e) => ({
      id: e.id,
      date: e.date,
      cents: e.cents,
      categoryId: e.categoryId,
      categoryName: e.categoryName,
      categoryKey: e.categoryKey,
      description: e.description,
      recurring: e.recurringId !== null,
    }));
    // Gasto variável: o que não vem de recorrência (essas já estão nos eventos).
    const variableSpending = expenses.filter((e) => !e.recurring).map((e) => ({ date: e.date, cents: e.cents }));

    const incomes = await tx
      .select({ date: t.date, cents: t.amountCents })
      .from(t)
      .where(and(isNull(t.deletedAt), eq(t.type, "income"), gte(t.date, since), sql`${t.date} <= ${today}`));

    const recurrences = await tx.select({ description: rec.description, type: rec.type, active: rec.active }).from(rec);
    const incomeRegular =
      !!profile?.frequency && profile.frequency !== "irregular" && recurrences.some((r) => r.active && r.type === "income");

    const goalViews = await this.goals.listInTx(tx);
    const completed = await tx.select({ id: goalsT.id, completedAt: goalsT.completedAt }).from(goalsT);
    const contributions = await tx
      .select({ goalId: gc.goalId, cents: sql<number>`sum(${q(gc.amountCents)})::bigint`.mapWith(Number) })
      .from(gc)
      .where(gte(gc.date, addDays(today, -90)))
      .groupBy(gc.goalId);
    const goals = goalViews.map((g) => {
      const done = completed.find((c) => c.id === g.id)?.completedAt;
      return {
        id: g.id,
        name: g.name,
        status: g.status,
        targetAmountCents: g.targetAmountCents,
        currentAmountCents: g.currentAmountCents,
        targetDate: g.targetDate,
        monthlyNeededCents: g.monthlyNeededCents,
        completedOn: done ? todayIn(tz, done) : null,
        contributions90Cents: contributions.find((c) => c.goalId === g.id)?.cents ?? 0,
      };
    });
    const goalsMonthlyCents = goals.reduce((s, g) => s + (g.status === "active" ? (g.monthlyNeededCents ?? 0) : 0), 0);

    return {
      today,
      plan,
      hasAccounts: accounts.length > 0,
      historyDays,
      incomeRegular,
      events,
      variableSpending,
      goalsMonthlyCents,
      detector: {
        today,
        expenses,
        incomes,
        recurringDescriptions: recurrences.map((r) => r.description),
        commitments,
        cards: cards.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, usedLimitCents: c.usedLimitCents, limitCents: c.limitCents })),
        goals,
        balanceCents,
        avgMonthlyIncomeCents: profile?.income ?? null,
        historyDays,
      },
    };
  }
}
