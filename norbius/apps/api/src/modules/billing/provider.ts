import type { BillingCycle, IsoDate } from "@norbius/domain";

/** Cobrança como o NORBIUS a entende, independente do provedor. */
export interface ProviderPayment {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  amountCents: number;
  status: "pending" | "paid" | "overdue" | "refunded" | "canceled";
  billingType: string | null;
  dueDate: IsoDate;
  invoiceUrl: string | null;
}

export interface BillingProvider {
  readonly name: "asaas" | "fake";
  createCustomer(input: { name: string; email: string; cpfCnpj: string; externalReference: string }): Promise<{ id: string }>;
  createSubscription(input: {
    customerId: string;
    cycle: BillingCycle;
    amountCents: number;
    nextDueDate: IsoDate;
    description: string;
    externalReference: string;
  }): Promise<{ id: string }>;
  /** Primeira cobrança gerada pela assinatura (com o link de pagamento). */
  firstPayment(subscriptionId: string): Promise<ProviderPayment | null>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}

/** Provedor fora do ar ou recusando por motivo técnico: nada foi cobrado. */
export class BillingUnavailableError extends Error {}

/** Recusa de dados pelo provedor (ex.: CPF inválido para ele). */
export class BillingRejectedError extends Error {}

/** Status de cobrança do Asaas → status do NORBIUS. */
export function mapAsaasStatus(status: string | undefined): ProviderPayment["status"] {
  switch (status) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
      return "paid";
    case "OVERDUE":
      return "overdue";
    case "REFUNDED":
    case "REFUND_REQUESTED":
    case "REFUND_IN_PROGRESS":
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "AWAITING_CHARGEBACK_REVERSAL":
      return "refunded";
    default:
      return "pending";
  }
}
