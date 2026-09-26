import { z } from "zod";
import { fromAsaasPayment } from "./asaas";
import type { BillingEvent } from "./billing.service";

// Só os campos usados; o resto do corpo do Asaas é ignorado (e não é guardado).
const paymentSchema = z.object({
  id: z.string().min(1),
  customer: z.string().min(1),
  subscription: z.string().nullish(),
  value: z.number().nonnegative(),
  status: z.string().optional(),
  billingType: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  invoiceUrl: z.string().url().nullish(),
});

const eventSchema = z.object({
  id: z.string().min(1).max(200),
  event: z.string().min(1).max(100),
  payment: paymentSchema.optional(),
  subscription: z.object({ id: z.string().min(1), customer: z.string().min(1) }).optional(),
});

const PAYMENT_EVENTS = new Set([
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_RESTORED",
]);
const SUBSCRIPTION_ENDED = new Set(["SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"]);

/** Corpo do webhook do Asaas → evento normalizado; `null` se não for um evento válido. */
export function parseAsaasEvent(body: unknown): BillingEvent | null {
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return null;
  const { id, event, payment, subscription } = parsed.data;
  if (PAYMENT_EVENTS.has(event) && payment) {
    const p = fromAsaasPayment(payment);
    return { id, type: event, kind: "payment", payment: event === "PAYMENT_DELETED" ? { ...p, status: "canceled" } : p };
  }
  if (SUBSCRIPTION_ENDED.has(event) && subscription) {
    return { id, type: event, kind: "subscription_ended", subscriptionId: subscription.id, customerId: subscription.customer };
  }
  return { id, type: event, kind: "ignored" };
}
