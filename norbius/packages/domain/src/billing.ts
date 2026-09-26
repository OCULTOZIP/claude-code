import { addDays, addMonths, compareDates, type IsoDate } from "./dates";

// Planos do NORBIUS (Fase 6, ADR 0004). Valores em centavos.
export type PlanId = "free" | "pro";
export type BillingCycle = "monthly" | "yearly";

export const PRO_PRICE_CENTS: Record<BillingCycle, number> = { monthly: 1490, yearly: 14900 };
export const TRIAL_DAYS = 7;
/** Dias de acesso Pro mantidos após o vencimento de uma cobrança não paga. */
export const GRACE_DAYS = 7;
export const FREE_MAX_ACTIVE_GOALS = 3;
/** Mensagens por mês com o assistente no Pro (padrão; a API aceita AI_MONTHLY_MESSAGE_LIMIT). */
export const PRO_AI_MESSAGES_PER_MONTH = 100;

export type SubscriptionStatus = "none" | "trialing" | "pending" | "active" | "past_due" | "canceled";

/** Estado persistido da assinatura; o acesso é derivado por datas, nunca armazenado. */
export interface SubscriptionState {
  status: SubscriptionStatus;
  /** Último dia (inclusive) do teste grátis. */
  trialEndsOn: IsoDate | null;
  /** Último dia (inclusive) coberto por pagamento confirmado. */
  paidThrough: IsoDate | null;
  cancelAtPeriodEnd: boolean;
}

export type AccessReason = "paid" | "grace" | "trial" | "free";

export interface Entitlements {
  plan: PlanId;
  reason: AccessReason;
  /** Até quando (inclusive) o acesso Pro está garantido. */
  proUntil: IsoDate | null;
  assistant: boolean;
  maxActiveGoals: number | null;
}

const PRO = { plan: "pro", assistant: true, maxActiveGoals: null } as const;
const FREE: Entitlements = { plan: "free", reason: "free", proUntil: null, assistant: false, maxActiveGoals: FREE_MAX_ACTIVE_GOALS };

export function entitlements(s: SubscriptionState, today: IsoDate): Entitlements {
  if (s.paidThrough && compareDates(today, s.paidThrough) <= 0) return { ...PRO, reason: "paid", proUntil: s.paidThrough };
  if (s.status === "past_due" && s.paidThrough) {
    const graceEnd = addDays(s.paidThrough, GRACE_DAYS);
    if (compareDates(today, graceEnd) <= 0) return { ...PRO, reason: "grace", proUntil: graceEnd };
  }
  if (s.trialEndsOn && compareDates(today, s.trialEndsOn) <= 0) return { ...PRO, reason: "trial", proUntil: s.trialEndsOn };
  return FREE;
}

export function trialEnd(start: IsoDate): IsoDate {
  return addDays(start, TRIAL_DAYS - 1);
}

/** Último dia coberto por uma cobrança com vencimento `dueDate`. */
export function periodEnd(dueDate: IsoDate, cycle: BillingCycle): IsoDate {
  return addDays(addMonths(dueDate, cycle === "monthly" ? 1 : 12), -1);
}

/** Estende a cobertura sem nunca encurtá-la (webhooks podem chegar fora de ordem). */
export function extendPaidThrough(current: IsoDate | null, dueDate: IsoDate, cycle: BillingCycle): IsoDate {
  const end = periodEnd(dueDate, cycle);
  return current && compareDates(current, end) > 0 ? current : end;
}
