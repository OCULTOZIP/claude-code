import type { BillingProvider, ProviderPayment } from "./provider";

/**
 * Provedor em memória para testes automatizados e E2E. Nunca é usado com
 * dinheiro real: só é carregado com APP_ENV=test (ver env.ts). A "página de
 * pagamento" aponta de volta para o próprio app.
 */
export class FakeBillingProvider implements BillingProvider {
  readonly name = "fake" as const;
  readonly payments = new Map<string, ProviderPayment>();
  readonly canceled = new Set<string>();
  customers = 0;

  constructor(private readonly appUrl: string) {}

  async createCustomer() {
    this.customers++;
    return { id: `cus_fake_${crypto.randomUUID()}` };
  }

  async createSubscription(input: Parameters<BillingProvider["createSubscription"]>[0]) {
    const id = `sub_fake_${crypto.randomUUID()}`;
    const payId = `pay_fake_${crypto.randomUUID()}`;
    this.payments.set(id, {
      id: payId,
      customerId: input.customerId,
      subscriptionId: id,
      amountCents: input.amountCents,
      status: "pending",
      billingType: null,
      dueDate: input.nextDueDate,
      // Os parâmetros permitem ao E2E simular o webhook do provedor.
      invoiceUrl: `${this.appUrl}/configuracoes/plano?cobranca=${payId}&cliente=${input.customerId}&venc=${input.nextDueDate}`,
    });
    return { id };
  }

  async firstPayment(subscriptionId: string) {
    return this.payments.get(subscriptionId) ?? null;
  }

  async cancelSubscription(subscriptionId: string) {
    this.canceled.add(subscriptionId);
  }
}
