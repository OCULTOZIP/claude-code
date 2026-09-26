import { qualified as q, schema, withUserContext, type Database, type Transaction } from "@norbius/db";
import { addMonthsToMonth, compareDates, monthOf, monthRange, type IsoMonth } from "@norbius/domain";
import { and, desc, gte, isNull, lte, sql } from "drizzle-orm";
import { HttpError } from "../../plugins/errors";
import { userToday } from "../../lib/user-context";
import type { AccountsRepository } from "../accounts/accounts.repository";
import type { BillingService } from "../billing/billing.service";
import type { CardsRepository } from "../cards/cards.repository";
import type { DashboardService } from "../dashboard/dashboard.service";
import type { GoalsService } from "../goals/goals.service";

const t = schema.transactions;
const p = schema.creditCardPurchases;
const ct = schema.creditCardTransactions;
const cat = schema.categories;
const ins = schema.insights;

export const reportPlanRequired = () =>
  new HttpError(403, "PLAN_REQUIRED", "Os relatórios completos fazem parte do plano Pro. No plano grátis, exporte suas transações em CSV.");

export type MonthlyReport = {
  month: IsoMonth;
  /** Mês ainda em andamento: números até hoje. */
  partial: boolean;
  generatedOn: string;
  name: string;
  incomeCents: number;
  expenseCents: number;
  previous: { month: IsoMonth; incomeCents: number; expenseCents: number };
  categories: { name: string; cents: number; share: number }[];
  topExpenses: { date: string; description: string; category: string; cents: number; card: boolean }[];
  accounts: { name: string; balanceCents: number }[];
  invoices: { card: string; dueDate: string; totalCents: number; paidCents: number }[];
  goals: { name: string; currentCents: number; targetCents: number; progress: number }[];
  insights: { severity: string; title: string }[];
};

/** Relatório mensal (Fase 5): dados reais do mês, sem estimativas além das rotuladas. */
export class ReportsService {
  constructor(
    private readonly db: Database,
    private readonly accounts: AccountsRepository,
    private readonly cardsRepo: CardsRepository,
    private readonly goals: GoalsService,
    private readonly dashboard: DashboardService,
    private readonly billing: BillingService,
  ) {}

  /** Meses com algum registro, do mais recente ao mais antigo (até 24). */
  async months(userId: string): Promise<{ months: IsoMonth[]; pro: boolean }> {
    return withUserContext(this.db, userId, async (tx) => {
      const today = await userToday(tx);
      const pro = (await this.billing.entitlementsInTx(tx)).plan === "pro";
      const days = await this.dashboard.historyDays(tx, today);
      if (!days) return { months: [], pro };
      const first = monthOf(
        (
          await tx.execute<{ d: string }>(sql`select least(
            (select min(${q(t.date)}) from ${t} where ${q(t.deletedAt)} is null),
            (select min(${q(p.purchaseDate)}) from ${p} where ${q(p.deletedAt)} is null))::text as d`)
        )[0]!.d,
      );
      const out: IsoMonth[] = [];
      for (let m = monthOf(today); m >= first && out.length < 24; m = addMonthsToMonth(m, -1)) out.push(m);
      return { months: out, pro };
    });
  }

  async monthly(userId: string, month: IsoMonth): Promise<MonthlyReport> {
    return withUserContext(this.db, userId, async (tx) => {
      if ((await this.billing.entitlementsInTx(tx)).plan !== "pro") throw reportPlanRequired();
      const today = await userToday(tx);
      if (month > monthOf(today)) throw new HttpError(400, "VALIDATION_ERROR", "Esse mês ainda não começou.");
      const { start, end } = monthRange(month);
      const until = compareDates(end, today) > 0 ? today : end;
      const prev = addMonthsToMonth(month, -1);
      const prevRange = monthRange(prev);

      const [profile] = await tx.select({ name: schema.profiles.displayName }).from(schema.profiles).limit(1);
      const flow = (from: string, to: string) => this.flow(tx, from, to);
      const current = await flow(start, until);
      const previous = await flow(prevRange.start, prevRange.end);

      const categories = await this.dashboard.categoryBreakdown(tx, start, until);
      const accounts = (await this.accounts.list(tx, until)).map((a) => ({ name: a.name, balanceCents: a.balanceCents }));
      const invoices = (await this.cardsRepo.listAllInvoices(tx))
        .filter((i) => i.dueDate >= start && i.dueDate <= end)
        .map((i) => ({ card: i.cardName, dueDate: i.dueDate, totalCents: i.totalCents, paidCents: i.paidCents }));
      const goals = (await this.goals.listInTx(tx))
        .filter((g) => g.status !== "archived")
        .map((g) => ({ name: g.name, currentCents: g.currentAmountCents, targetCents: g.targetAmountCents, progress: g.progress }));
      const insights = await tx
        .select({ severity: ins.severity, title: ins.title })
        .from(ins)
        .where(and(gte(ins.createdAt, new Date(`${start}T00:00:00Z`)), lte(ins.createdAt, new Date(`${end}T23:59:59Z`))))
        .orderBy(desc(ins.createdAt))
        .limit(12);

      return {
        month,
        partial: until !== end,
        generatedOn: today,
        name: profile?.name ?? "",
        incomeCents: current.income,
        expenseCents: current.expense,
        previous: { month: prev, incomeCents: previous.income, expenseCents: previous.expense },
        categories: categories.map((c) => ({ name: c.name, cents: c.cents, share: c.share })),
        topExpenses: await this.topExpenses(tx, start, until),
        accounts,
        invoices,
        goals,
        insights,
      };
    });
  }

  /** Receitas e despesas (cartão por competência; pagamento de fatura não é despesa). */
  private async flow(tx: Transaction, from: string, to: string) {
    const [acc] = await tx
      .select({
        income: sql<number>`coalesce(sum(${t.amountCents}) filter (where ${t.type} = 'income'), 0)`.mapWith(Number),
        expense: sql<number>`coalesce(sum(${t.amountCents}) filter (where ${t.type} = 'expense'), 0)`.mapWith(Number),
      })
      .from(t)
      .where(and(isNull(t.deletedAt), gte(t.date, from), lte(t.date, to)));
    const [card] = await tx.execute<{ c: string }>(sql`
      select coalesce(sum(${q(ct.amountCents)}), 0)::bigint as c from ${ct} join ${p} on ${q(p.id)} = ${q(ct.purchaseId)}
      where ${q(p.deletedAt)} is null and ${q(ct.competenceDate)} between ${from} and ${to}`);
    return { income: acc!.income, expense: acc!.expense + Number(card!.c) };
  }

  private async topExpenses(tx: Transaction, from: string, to: string): Promise<MonthlyReport["topExpenses"]> {
    const rows = await tx.execute<{ d: string; description: string; category: string | null; cents: string; card: boolean }>(sql`
      select * from (
        select ${q(t.date)}::text as d, ${q(t.description)} as description, c.name as category, ${q(t.amountCents)} as cents, false as card
          from ${t} left join ${cat} c on c.id = ${q(t.categoryId)}
          where ${q(t.deletedAt)} is null and ${q(t.type)} = 'expense' and ${q(t.date)} between ${from} and ${to}
        union all
        select ${q(ct.competenceDate)}::text, ${q(p.description)}, c.name, ${q(ct.amountCents)}, true
          from ${ct} join ${p} on ${q(p.id)} = ${q(ct.purchaseId)} left join ${cat} c on c.id = ${q(ct.categoryId)}
          where ${q(p.deletedAt)} is null and ${q(ct.competenceDate)} between ${from} and ${to}
      ) x order by cents desc, d desc limit 10`);
    return [...rows].map((r) => ({ date: r.d, description: r.description, category: r.category ?? "Sem categoria", cents: Number(r.cents), card: r.card }));
  }
}
