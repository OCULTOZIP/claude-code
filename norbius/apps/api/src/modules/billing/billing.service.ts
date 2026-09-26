import type { BillingOverview, BillingPaymentView, CheckoutInput } from "@norbius/contracts";
import { schema, withUserContext, type Database, type Transaction } from "@norbius/db";
import {
  entitlements,
  extendPaidThrough,
  PRO_PRICE_CENTS,
  trialEnd,
  type BillingCycle,
  type Entitlements,
  type SubscriptionState,
} from "@norbius/domain";
import type { Logger } from "@norbius/observability";
import { desc, eq, sql } from "drizzle-orm";
import type { AuditLogger } from "../../lib/audit";
import { userToday } from "../../lib/user-context";
import { badRequest, conflict, HttpError } from "../../plugins/errors";
import { BillingRejectedError, BillingUnavailableError, type BillingProvider, type ProviderPayment } from "./provider";

const subs = schema.subscriptions;
const pays = schema.billingPayments;
const events = schema.billingEvents;

type SubRow = typeof subs.$inferSelect;

/** Evento de webhook já normalizado (ver webhook.ts). */
export type BillingEvent =
  | { id: string; type: string; kind: "payment"; payment: ProviderPayment }
  | { id: string; type: string; kind: "subscription_ended"; subscriptionId: string; customerId: string }
  | { id: string; type: string; kind: "ignored" };

export const planRequired = () =>
  new HttpError(403, "PLAN_REQUIRED", "O assistente NORBIUS faz parte do plano Pro. Comece o teste grátis ou assine em Configurações → Plano.");

const unavailable = () =>
  new HttpError(503, "BILLING_UNAVAILABLE", "O pagamento não está disponível agora. Nada foi cobrado; tente novamente em alguns minutos.");

function stateOf(row: SubRow | undefined): SubscriptionState {
  return {
    status: row?.status ?? "none",
    trialEndsOn: row?.trialEndsOn ?? null,
    paidThrough: row?.paidThrough ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
  };
}

function view(p: typeof pays.$inferSelect): BillingPaymentView {
  return {
    id: p.id,
    amountCents: p.amountCents,
    status: p.status,
    billingType: p.billingType,
    dueDate: p.dueDate,
    paidAt: p.paidAt?.toISOString() ?? null,
    invoiceUrl: p.invoiceUrl,
  };
}

export class BillingService {
  constructor(
    private readonly db: Database,
    private readonly provider: BillingProvider | null,
    private readonly audit: AuditLogger,
    private readonly log: Logger,
  ) {}

  private record(userId: string, action: string, requestId?: string) {
    return this.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action, entityType: "subscription", entityId: userId, requestId: requestId ?? null });
  }

  private async row(tx: Transaction, lock = false): Promise<SubRow | undefined> {
    const q = tx.select().from(subs).limit(1);
    const [row] = lock ? await q.for("update") : await q;
    return row;
  }

  /** Direitos do usuário no contexto RLS atual (usado por metas e pelo assistente). */
  async entitlementsInTx(tx: Transaction): Promise<Entitlements> {
    return entitlements(stateOf(await this.row(tx)), await userToday(tx));
  }

  entitlements(userId: string) {
    return withUserContext(this.db, userId, (tx) => this.entitlementsInTx(tx));
  }

  overview(userId: string): Promise<BillingOverview> {
    return withUserContext(this.db, userId, async (tx) => {
      const row = await this.row(tx);
      const ent = entitlements(stateOf(row), await userToday(tx));
      const history = (await tx.select().from(pays).orderBy(desc(pays.dueDate), desc(pays.createdAt)).limit(24)).map(view);
      const open = history.find((p) => (p.status === "pending" || p.status === "overdue") && p.invoiceUrl) ?? null;
      return {
        plan: ent.plan,
        reason: ent.reason,
        proUntil: ent.proUntil,
        status: row?.status ?? "none",
        cycle: row?.cycle ?? null,
        cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
        trialAvailable: !row?.trialStartedAt && !row?.paidThrough,
        checkoutAvailable: this.provider !== null,
        prices: PRO_PRICE_CENTS,
        openPayment: row?.status === "canceled" ? null : open,
        payments: history,
        limits: { maxActiveGoals: ent.maxActiveGoals, assistant: ent.assistant },
      };
    });
  }

  async startTrial(userId: string, requestId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const row = await this.row(tx, true);
      if (row?.trialStartedAt || row?.paidThrough) throw conflict("TRIAL_USED", "O teste grátis já foi usado nesta conta.");
      const trialEndsOn = trialEnd(await userToday(tx));
      await tx
        .insert(subs)
        .values({ userId, status: "trialing", trialStartedAt: new Date(), trialEndsOn })
        .onConflictDoUpdate({ target: subs.userId, set: { status: "trialing", trialStartedAt: new Date(), trialEndsOn } });
    });
    await this.record(userId, "billing.trial_start", requestId);
    return this.overview(userId);
  }

  /**
   * Cria (ou reaproveita) o cliente no provedor e a assinatura com vencimento
   * hoje; devolve o link da primeira cobrança. O acesso Pro só é liberado
   * quando o webhook confirmar o pagamento.
   */
  async checkout(userId: string, input: CheckoutInput, requestId: string): Promise<{ invoiceUrl: string }> {
    const provider = this.provider;
    if (!provider) throw unavailable();
    try {
      const url = await withUserContext(this.db, userId, async (tx) => {
        const row = await this.row(tx, true);
        if (row?.providerSubscriptionId && row.status !== "canceled") {
          const [open] = await tx
            .select()
            .from(pays)
            .where(sql`${pays.providerSubscriptionId} = ${row.providerSubscriptionId} and ${pays.status} in ('pending','overdue')`)
            .orderBy(pays.dueDate)
            .limit(1);
          if (row.status === "pending" && open?.invoiceUrl) return open.invoiceUrl;
          throw conflict("ALREADY_SUBSCRIBED", "Você já tem uma assinatura ativa. Para trocar de plano, cancele a atual primeiro.");
        }
        const [user] = await tx.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
        let customerId = row?.providerCustomerId ?? null;
        if (!customerId) {
          customerId = (await provider.createCustomer({ name: user!.name, email: user!.email, cpfCnpj: input.cpfCnpj, externalReference: userId })).id;
        }
        const cycle: BillingCycle = input.cycle;
        const sub = await provider.createSubscription({
          customerId,
          cycle,
          amountCents: PRO_PRICE_CENTS[cycle],
          nextDueDate: await userToday(tx),
          description: cycle === "monthly" ? "NORBIUS Pro — mensal" : "NORBIUS Pro — anual",
          externalReference: userId,
        });
        const values = {
          status: "pending" as const,
          cycle,
          provider: provider.name,
          providerCustomerId: customerId,
          providerSubscriptionId: sub.id,
          cancelAtPeriodEnd: false,
          canceledAt: null,
        };
        await tx.insert(subs).values({ userId, ...values }).onConflictDoUpdate({ target: subs.userId, set: values });
        const first = await provider.firstPayment(sub.id);
        if (!first?.invoiceUrl) throw new BillingUnavailableError();
        await this.upsertPayment(tx, userId, first);
        return first.invoiceUrl;
      });
      await this.record(userId, "billing.checkout", requestId);
      return { invoiceUrl: url };
    } catch (err) {
      if (err instanceof BillingRejectedError) throw badRequest("BILLING_REJECTED", err.message);
      if (err instanceof BillingUnavailableError) throw unavailable();
      throw err;
    }
  }

  /** Cancela a renovação; o acesso pago continua até o fim do período. */
  async cancel(userId: string, requestId: string) {
    const provider = this.provider;
    await withUserContext(this.db, userId, async (tx) => {
      const row = await this.row(tx, true);
      if (!row?.providerSubscriptionId || row.status === "canceled") throw conflict("NO_SUBSCRIPTION", "Não há assinatura ativa para cancelar.");
      if (!provider) throw unavailable();
      try {
        await provider.cancelSubscription(row.providerSubscriptionId);
      } catch (err) {
        if (err instanceof BillingUnavailableError || err instanceof BillingRejectedError) throw unavailable();
        throw err;
      }
      await tx.update(subs).set({ status: "canceled", cancelAtPeriodEnd: true, canceledAt: new Date() }).where(eq(subs.userId, userId));
      await tx
        .update(pays)
        .set({ status: "canceled" })
        .where(sql`${pays.providerSubscriptionId} = ${row.providerSubscriptionId} and ${pays.status} = 'pending'`);
    });
    await this.record(userId, "billing.cancel", requestId);
    return this.overview(userId);
  }

  private async upsertPayment(tx: Transaction, userId: string, p: ProviderPayment) {
    const values = {
      providerSubscriptionId: p.subscriptionId,
      amountCents: p.amountCents,
      status: p.status,
      billingType: p.billingType,
      dueDate: p.dueDate,
      invoiceUrl: p.invoiceUrl,
      paidAt: p.status === "paid" ? new Date() : null,
    };
    await tx
      .insert(pays)
      .values({ userId, providerPaymentId: p.id, ...values })
      .onConflictDoUpdate({
        target: pays.providerPaymentId,
        set: {
          ...values,
          // Um pagamento confirmado não volta a "pendente" por evento fora de ordem.
          status: sql`case when ${pays.status} = 'paid' and excluded.status in ('pending','overdue') then ${pays.status} else excluded.status end`,
          paidAt: sql`coalesce(${pays.paidAt}, excluded.paid_at)`,
        },
      });
  }

  /**
   * Processa um evento do provedor exatamente uma vez. Se algo falhar, a
   * transação inteira (inclusive o registro do evento) é desfeita e o
   * provedor reenvia.
   */
  async handleEvent(e: BillingEvent, providerName: string): Promise<string> {
    const customerId = e.kind === "payment" ? e.payment.customerId : e.kind === "subscription_ended" ? e.customerId : null;
    const userId = customerId ? await this.userByCustomer(customerId) : null;
    if (!userId) {
      const [ins] = await this.db
        .insert(events)
        .values({ id: e.id, provider: providerName, type: e.type, outcome: e.kind === "ignored" ? "ignored" : "unknown_customer" })
        .onConflictDoNothing()
        .returning({ id: events.id });
      if (ins && e.kind !== "ignored") this.log.warn({ event: e.type }, "billing: evento de cliente desconhecido");
      return ins ? (e.kind === "ignored" ? "ignored" : "unknown_customer") : "duplicate";
    }
    return withUserContext(this.db, userId, async (tx) => {
      const [ins] = await tx.insert(events).values({ id: e.id, provider: providerName, type: e.type }).onConflictDoNothing().returning({ id: events.id });
      if (!ins) return "duplicate";
      const row = await this.row(tx, true);
      let outcome = "recorded";
      if (e.kind === "payment") {
        await this.upsertPayment(tx, userId, e.payment);
        if (e.payment.status === "paid") {
          const paidThrough = extendPaidThrough(row?.paidThrough ?? null, e.payment.dueDate, row?.cycle ?? "monthly");
          await tx.update(subs).set({ paidThrough, ...(row?.status === "canceled" ? {} : { status: "active" as const }) }).where(eq(subs.userId, userId));
          outcome = "paid";
        } else if (e.payment.status === "overdue" && (row?.status === "active" || row?.status === "pending")) {
          await tx.update(subs).set({ status: "past_due" }).where(eq(subs.userId, userId));
          outcome = "past_due";
        } else if (e.payment.status === "refunded") {
          // Estorno não revoga acesso automaticamente: fica registrado para análise.
          this.log.warn({ event: e.type }, "billing: estorno registrado");
          outcome = "refunded";
        }
      } else if (e.kind === "subscription_ended" && row?.providerSubscriptionId === e.subscriptionId && row.status !== "canceled") {
        await tx.update(subs).set({ status: "canceled", cancelAtPeriodEnd: true, canceledAt: new Date() }).where(eq(subs.userId, userId));
        outcome = "canceled";
      }
      await tx.update(events).set({ outcome }).where(eq(events.id, e.id));
      return outcome;
    });
  }

  private async userByCustomer(customerId: string): Promise<string | null> {
    const rows = await this.db.execute<{ user_id: string | null }>(sql`select norbius_billing_user(${customerId}) as user_id`);
    return rows[0]?.user_id ?? null;
  }
}
