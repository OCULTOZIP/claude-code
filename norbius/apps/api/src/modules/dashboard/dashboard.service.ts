import type { Commitment, DashboardSummary } from "@norbius/contracts";
import { qualified as q, schema, withUserContext, type Database, type Transaction } from "@norbius/db";
import { addDays, compareDates, diffDays, monthOf, monthRange, occurrencesBetween } from "@norbius/domain";
import { and, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import { userToday } from "../../lib/user-context";
import type { AccountsRepository } from "../accounts/accounts.repository";
import type { CardsRepository } from "../cards/cards.repository";
import type { CardsService } from "../cards/cards.service";
import type { GoalsService } from "../goals/goals.service";
import type { IntelligenceService } from "../intelligence/intelligence.service";
import { pendingDate, ruleOf } from "../recurring/recurring.service";

const t = schema.transactions;
const p = schema.creditCardPurchases;
const ct = schema.creditCardTransactions;
const cat = schema.categories;
const r = schema.recurringTransactions;

const COMMITMENT_WINDOW_DAYS = 30;

export class DashboardService {
  constructor(
    readonly db: Database,
    private readonly accounts: AccountsRepository,
    private readonly cardsRepo: CardsRepository,
    private readonly cards: CardsService,
    private readonly goals: GoalsService,
  ) {}

  private intelligence: IntelligenceService | null = null;

  /** A inteligência depende do painel (compromissos, histórico); a ligação é feita depois de construir os dois. */
  attachIntelligence(intelligence: IntelligenceService) {
    this.intelligence = intelligence;
  }

  async summary(userId: string): Promise<DashboardSummary> {
    const cards = await this.cards.list(userId);
    if (!this.intelligence) throw new Error("DashboardService sem IntelligenceService");
    const intelligence = await this.intelligence.summary(userId);
    return withUserContext(this.db, userId, async (tx) => {
      const today = await userToday(tx);
      const month = monthOf(today);
      const { start, end } = monthRange(month);

      const accounts = await this.accounts.list(tx, today);
      const available = accounts.filter((a) => a.includeInAvailableBalance).reduce((s, a) => s + a.balanceCents, 0);
      const investments = accounts.filter((a) => a.type === "investment").reduce((s, a) => s + a.balanceCents, 0);

      // Receitas/despesas do mês até hoje. Compras no cartão contam pela
      // competência de cada parcela; pagamento de fatura não é despesa.
      const [flow] = await tx
        .select({
          income: sql<number>`coalesce(sum(${t.amountCents}) filter (where ${t.type} = 'income'), 0)`.mapWith(Number),
          expense: sql<number>`coalesce(sum(${t.amountCents}) filter (where ${t.type} = 'expense'), 0)`.mapWith(Number),
        })
        .from(t)
        .where(and(isNull(t.deletedAt), gte(t.date, start), lte(t.date, today)));
      const [cardFlow] = await tx
        .select({ expense: sql<number>`coalesce(sum(${ct.amountCents}), 0)`.mapWith(Number) })
        .from(ct)
        .innerJoin(p, eq(p.id, ct.purchaseId))
        .where(and(isNull(p.deletedAt), gte(ct.competenceDate, start), lte(ct.competenceDate, today)));

      const topCategories = (await this.categoryBreakdown(tx, start, today)).slice(0, 6);
      const dailyFlow = await this.dailyFlow(tx, start, end, today);
      const recent = await this.recent(tx);
      const commitments = await this.commitments(tx, today);
      const goals = (await this.goals.listInTx(tx)).filter((g) => g.status === "active").slice(0, 4);

      const historyDays = await this.historyDays(tx, today);
      const hasMovements = historyDays > 0;

      return {
        month,
        today,
        hasData: accounts.length > 0 || hasMovements,
        availableBalance: { cents: available, kind: "actual" },
        monthIncome: { cents: flow!.income, kind: "actual" },
        monthExpense: { cents: flow!.expense + cardFlow!.expense, kind: "actual" },
        investments: { cents: investments, kind: "actual" },
        accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balanceCents: a.balanceCents })),
        topCategories,
        commitments,
        recent,
        goals: goals.map((g) => ({
          id: g.id,
          name: g.name,
          progress: g.progress,
          currentAmountCents: g.currentAmountCents,
          targetAmountCents: g.targetAmountCents,
        })),
        cards: cards.map((c) => ({ id: c.id, name: c.name, usedLimitCents: c.usedLimitCents, limitCents: c.limitCents })),
        dailyFlow,
        core: { state: intelligence.core.state, reason: intelligence.core.reason, historyDays },
        intelligence,
      };
    });
  }

  /** Dias desde o primeiro lançamento (conta ou cartão), inclusive hoje; 0 sem lançamentos. */
  async historyDays(tx: Transaction, today: string): Promise<number> {
    const [first] = await tx
      .select({
        d: sql<string | null>`least(
          (select min(${q(t.date)}) from ${t} where ${q(t.deletedAt)} is null),
          (select min(${q(p.purchaseDate)}) from ${p} where ${q(p.deletedAt)} is null))`,
      })
      .from(sql`(select 1) as one`);
    return first?.d ? Math.max(0, diffDays(today, first.d) + 1) : 0;
  }

  /** Despesas por categoria no intervalo (contas + parcelas de cartão por competência). */
  async categoryBreakdown(tx: Transaction, start: string, today: string) {
    const rows = await tx.execute<{ category_id: string; name: string; cents: string }>(sql`
      select c.id as category_id, c.name, sum(x.cents)::bigint as cents from (
        select ${q(t.categoryId)} as category_id, ${q(t.amountCents)} as cents from ${t}
          where ${q(t.deletedAt)} is null and ${q(t.type)} = 'expense' and ${q(t.date)} between ${start} and ${today}
        union all
        select ${q(ct.categoryId)}, ${q(ct.amountCents)} from ${ct} join ${p} on ${q(p.id)} = ${q(ct.purchaseId)}
          where ${q(p.deletedAt)} is null and ${q(ct.competenceDate)} between ${start} and ${today}
      ) x join ${cat} c on c.id = x.category_id
      group by c.id, c.name order by cents desc`);
    const list = [...rows].map((row) => ({ categoryId: row.category_id, name: row.name, cents: Number(row.cents) }));
    const total = list.reduce((s, x) => s + x.cents, 0);
    return list.map((x) => ({ ...x, share: total ? x.cents / total : 0 }));
  }

  private async dailyFlow(tx: Transaction, start: string, end: string, today: string) {
    const rows = await tx.execute<{ d: string; income: string; expense: string }>(sql`
      select d::text as d, sum(income)::bigint as income, sum(expense)::bigint as expense from (
        select ${q(t.date)} as d,
          case when ${q(t.type)} = 'income' then ${q(t.amountCents)} else 0 end as income,
          case when ${q(t.type)} = 'expense' then ${q(t.amountCents)} else 0 end as expense
          from ${t} where ${q(t.deletedAt)} is null and ${q(t.date)} between ${start} and ${today}
        union all
        select ${q(ct.competenceDate)}, 0, ${q(ct.amountCents)} from ${ct} join ${p} on ${q(p.id)} = ${q(ct.purchaseId)}
          where ${q(p.deletedAt)} is null and ${q(ct.competenceDate)} between ${start} and ${today}
      ) x group by d`);
    const byDay = new Map([...rows].map((row) => [row.d, { income: Number(row.income), expense: Number(row.expense) }]));
    const out: DashboardSummary["dailyFlow"] = [];
    for (let d = start; compareDates(d, end) <= 0; d = addDays(d, 1)) {
      const v = byDay.get(d);
      out.push({ date: d, incomeCents: v?.income ?? 0, expenseCents: v?.expense ?? 0 });
    }
    return out;
  }

  private async recent(tx: Transaction): Promise<DashboardSummary["recent"]> {
    const txs = await tx
      .select({ id: t.id, type: t.type, description: t.description, date: t.date, amountCents: t.amountCents, createdAt: t.createdAt, label: cat.name, invoice: t.creditCardInvoiceId })
      .from(t)
      .leftJoin(cat, eq(cat.id, t.categoryId))
      .where(isNull(t.deletedAt))
      .orderBy(desc(t.date), desc(t.createdAt))
      .limit(6);
    const purchases = await tx
      .select({ id: p.id, description: p.description, date: p.purchaseDate, amountCents: p.totalAmountCents, createdAt: p.createdAt, label: cat.name, installments: p.installmentCount })
      .from(p)
      .innerJoin(cat, eq(cat.id, p.categoryId))
      .where(isNull(p.deletedAt))
      .orderBy(desc(p.purchaseDate), desc(p.createdAt))
      .limit(6);
    return [
      ...txs.map((x) => ({
        id: x.id,
        kind: "transaction" as const,
        type: x.type,
        description: x.description,
        date: x.date,
        amountCents: x.amountCents,
        label: x.label ?? (x.invoice ? "Pagamento de fatura" : "Transferência"),
        createdAt: x.createdAt,
      })),
      ...purchases.map((x) => ({
        id: x.id,
        kind: "card_purchase" as const,
        type: "expense" as const,
        description: x.description,
        date: x.date,
        amountCents: x.amountCents,
        label: x.installments > 1 ? `${x.label} · ${x.installments}x no cartão` : `${x.label} · cartão`,
        createdAt: x.createdAt,
      })),
    ]
      .sort((a, b) => compareDates(b.date, a.date) || b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 6)
      .map(({ createdAt: _c, ...rest }) => rest);
  }

  /** Compromissos futuros: recorrências pendentes, faturas em aberto e lançamentos futuros. */
  async commitments(tx: Transaction, today: string, days = COMMITMENT_WINDOW_DAYS, limit = 12): Promise<Commitment[]> {
    const until = addDays(today, days);
    const out: Commitment[] = [];

    const recs = await tx.select().from(r).where(eq(r.active, true));
    for (const rec of recs) {
      const first = pendingDate(rec);
      if (!first) continue;
      // Ocorrências pendentes antigas (não registradas) aparecem como atrasadas.
      for (const date of occurrencesBetween(ruleOf(rec), first, until).slice(0, 5)) {
        out.push({
          kind: "recurring",
          id: rec.id,
          description: rec.description,
          date,
          amountCents: rec.amountCents,
          direction: rec.type === "income" ? "in" : "out",
          isEstimate: rec.amountIsEstimate,
          overdue: compareDates(date, today) < 0,
        });
      }
    }

    for (const inv of await this.cardsRepo.listAllInvoices(tx)) {
      const remaining = inv.totalCents - inv.paidCents;
      if (remaining <= 0 || compareDates(inv.dueDate, until) > 0) continue;
      const open = compareDates(today, inv.closingDate) < 0;
      out.push({
        kind: "invoice",
        id: inv.id,
        description: `Fatura ${inv.cardName}`,
        date: inv.dueDate,
        amountCents: remaining,
        direction: "out",
        isEstimate: open, // fatura aberta ainda pode receber compras
        overdue: compareDates(inv.dueDate, today) < 0,
      });
    }

    const scheduled = await tx
      .select()
      .from(t)
      .where(and(isNull(t.deletedAt), gt(t.date, today), lte(t.date, until)));
    for (const s of scheduled) {
      if (s.type === "transfer") continue;
      out.push({
        kind: "scheduled",
        id: s.id,
        description: s.description,
        date: s.date,
        amountCents: s.amountCents,
        direction: s.type === "income" ? "in" : "out",
        isEstimate: false,
        overdue: false,
      });
    }

    return out.sort((a, b) => compareDates(a.date, b.date)).slice(0, limit);
  }
}
