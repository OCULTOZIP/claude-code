import type { Logger } from "@norbius/observability";
import { mapAsaasStatus, BillingRejectedError, BillingUnavailableError, type BillingProvider, type ProviderPayment } from "./provider";

const BASE_URL = {
  sandbox: "https://sandbox.asaas.com/api/v3",
  production: "https://api.asaas.com/v3",
} as const;

type AsaasPayment = {
  id: string;
  customer: string;
  subscription?: string | null;
  value: number;
  status?: string;
  billingType?: string;
  dueDate: string;
  invoiceUrl?: string | null;
};

export function fromAsaasPayment(p: AsaasPayment): ProviderPayment {
  return {
    id: p.id,
    customerId: p.customer,
    subscriptionId: p.subscription ?? null,
    amountCents: Math.round(p.value * 100),
    status: mapAsaasStatus(p.status),
    billingType: p.billingType ?? null,
    dueDate: p.dueDate.slice(0, 10),
    invoiceUrl: p.invoiceUrl ?? null,
  };
}

/**
 * Asaas (API v3). Autenticação pelo cabeçalho `access_token`. A assinatura é
 * criada com `billingType: UNDEFINED`: o cliente escolhe Pix, boleto ou cartão
 * na página de pagamento do próprio Asaas — o NORBIUS nunca vê dados de cartão.
 */
export class AsaasProvider implements BillingProvider {
  readonly name = "asaas" as const;
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    env: "sandbox" | "production",
    private readonly log: Logger,
  ) {
    this.baseUrl = BASE_URL[env];
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { access_token: this.apiKey, "content-type": "application/json", "user-agent": "NORBIUS" },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.log.error({ err: String(err), path }, "asaas: falha de rede");
      throw new BillingUnavailableError();
    }
    const data = (await res.json().catch(() => null)) as { errors?: { description?: string }[] } | null;
    if (res.status === 400) {
      const description = data?.errors?.map((e) => e.description).filter(Boolean).join(" ") || "Dados recusados pelo meio de pagamento.";
      throw new BillingRejectedError(description);
    }
    if (!res.ok) {
      this.log.error({ status: res.status, path }, "asaas: resposta inesperada");
      throw new BillingUnavailableError();
    }
    return data as T;
  }

  async createCustomer(input: { name: string; email: string; cpfCnpj: string; externalReference: string }) {
    const c = await this.call<{ id: string }>("POST", "/customers", { ...input, notificationDisabled: false });
    return { id: c.id };
  }

  async createSubscription(input: Parameters<BillingProvider["createSubscription"]>[0]) {
    const s = await this.call<{ id: string }>("POST", "/subscriptions", {
      customer: input.customerId,
      billingType: "UNDEFINED",
      value: input.amountCents / 100,
      nextDueDate: input.nextDueDate,
      cycle: input.cycle === "monthly" ? "MONTHLY" : "YEARLY",
      description: input.description,
      externalReference: input.externalReference,
    });
    return { id: s.id };
  }

  async firstPayment(subscriptionId: string) {
    const list = await this.call<{ data: AsaasPayment[] }>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`);
    const first = [...list.data].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    return first ? fromAsaasPayment({ ...first, subscription: first.subscription ?? subscriptionId }) : null;
  }

  async cancelSubscription(subscriptionId: string) {
    await this.call("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }
}
