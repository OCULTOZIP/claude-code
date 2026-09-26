import { isValidTaxId, onlyDigits, type AccessReason, type BillingCycle, type PlanId, type SubscriptionStatus } from "@norbius/domain";
import { z } from "zod";

export const checkoutInputSchema = z.object({
  cycle: z.enum(["monthly", "yearly"]),
  cpfCnpj: z
    .string()
    .trim()
    .max(20)
    .transform(onlyDigits)
    .refine(isValidTaxId, "Informe um CPF ou CNPJ válido."),
});
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export interface BillingPaymentView {
  id: string;
  amountCents: number;
  status: "pending" | "paid" | "overdue" | "refunded" | "canceled";
  billingType: string | null;
  dueDate: string;
  paidAt: string | null;
  invoiceUrl: string | null;
}

export interface BillingOverview {
  plan: PlanId;
  reason: AccessReason;
  proUntil: string | null;
  status: SubscriptionStatus;
  cycle: BillingCycle | null;
  cancelAtPeriodEnd: boolean;
  trialAvailable: boolean;
  /** Pagamento configurado neste ambiente (sem chave, só o teste grátis funciona). */
  checkoutAvailable: boolean;
  prices: Record<BillingCycle, number>;
  /** Cobrança em aberto (link para pagar). */
  openPayment: BillingPaymentView | null;
  payments: BillingPaymentView[];
  limits: { maxActiveGoals: number | null; assistant: boolean };
}
