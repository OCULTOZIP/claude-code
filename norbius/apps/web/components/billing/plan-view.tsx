"use client";
import { api, ClientApiError } from "@/lib/client-api";
import { brl, longDate } from "@/lib/format";
import type { BillingOverview, BillingPaymentView } from "@norbius/contracts";
import { PRO_AI_MESSAGES_PER_MONTH, TRIAL_DAYS } from "@norbius/domain";
import { Alert, Badge, Button, buttonClasses, Card, CardBody, CardHeader, cn, Dialog, Field } from "@norbius/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const PAYMENT_STATUS: Record<BillingPaymentView["status"], string> = {
  pending: "Aguardando pagamento",
  paid: "Pago",
  overdue: "Vencido",
  refunded: "Estornado",
  canceled: "Cancelado",
};

const METHOD: Record<string, string> = { PIX: "Pix", BOLETO: "Boleto", CREDIT_CARD: "Cartão de crédito", UNDEFINED: "—" };

function fullDate(iso: string) {
  return `${longDate(iso)} de ${iso.slice(0, 4)}`;
}

function headline(o: BillingOverview): { title: string; detail: string } {
  if (o.plan === "free") {
    if (o.status === "pending") return { title: "Plano grátis", detail: "Sua assinatura Pro começa assim que o pagamento for confirmado." };
    if (o.status === "past_due") return { title: "Plano grátis", detail: "A cobrança venceu sem pagamento. Pague pelo link abaixo para liberar o Pro." };
    return { title: "Plano grátis", detail: "Organize suas finanças sem custo. O assistente NORBIUS e metas ilimitadas fazem parte do Pro." };
  }
  const until = o.proUntil ? fullDate(o.proUntil) : "";
  if (o.reason === "trial") return { title: "Pro · teste grátis", detail: `Seu teste vai até ${until}. Depois ele termina sozinho, sem cobrança.` };
  if (o.reason === "grace") return { title: "Pro · pagamento pendente", detail: `A última cobrança venceu. Seu acesso Pro continua até ${until}; pague pelo link abaixo para não perder.` };
  if (o.cancelAtPeriodEnd) return { title: "Pro · assinatura cancelada", detail: `Você continua com o Pro até ${until}. Depois, volta ao plano grátis sem perder nenhum dado.` };
  return { title: `Pro · ${o.cycle === "yearly" ? "anual" : "mensal"}`, detail: `Pago até ${until}. A renovação é automática; cancele quando quiser.` };
}

export function PlanView({ overview: o }: { overview: BillingOverview }) {
  const router = useRouter();
  const [error, setError] = useState<{ key: string; message: string }>();
  const [taxIdError, setTaxIdError] = useState<string>();
  const [loading, setLoading] = useState<string | null>(null);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("yearly");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const h = headline(o);
  const subscribed = o.status === "active" || o.status === "pending" || o.status === "past_due";
  const canSubscribe = !subscribed && o.reason !== "paid";
  const savings = Math.round((1 - o.prices.yearly / (o.prices.monthly * 12)) * 100);

  async function run(key: string, fn: () => Promise<void>) {
    setLoading(key);
    setError(undefined);
    setTaxIdError(undefined);
    try {
      await fn();
    } catch (err) {
      const field = err instanceof ClientApiError ? err.body?.error.fields?.cpfCnpj?.[0] : undefined;
      if (field) setTaxIdError(field);
      else setError({ key, message: err instanceof ClientApiError ? err.message : "Não foi possível concluir. Tente novamente." });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{h.title}</h2>
              {o.plan === "pro" ? <Badge tone="primary">Pro</Badge> : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-fg-secondary">{h.detail}</p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {o.openPayment?.invoiceUrl ? (
            <div className="flex flex-col gap-3 rounded-xl border border-line-strong bg-secondary px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">
                Cobrança de <strong className="tabular">{brl(o.openPayment.amountCents)}</strong> · vence em {fullDate(o.openPayment.dueDate)}
                <span className="block text-xs text-fg-muted">Pix, boleto ou cartão, na página segura do Asaas. A confirmação chega aqui automaticamente.</span>
              </p>
              <a href={o.openPayment.invoiceUrl} className={buttonClasses({ size: "sm" })} rel="noopener noreferrer">
                Pagar agora
              </a>
            </div>
          ) : null}

          {o.trialAvailable && !subscribed ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-fg-secondary">
                Experimente o Pro por {TRIAL_DAYS} dias. Não pedimos cartão e nada é cobrado no fim.
              </p>
              <Button
                variant="secondary"
                loading={loading === "trial"}
                onClick={() =>
                  run("trial", async () => {
                    await api("/billing/trial", { method: "POST", json: {} });
                    router.refresh();
                  })
                }
              >
                Começar teste grátis
              </Button>
            </div>
          ) : null}

          {subscribed ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setConfirmCancel(true)}>
                Cancelar assinatura
              </Button>
            </div>
          ) : null}
          {error && error.key !== "checkout" ? <Alert tone="error">{error.message}</Alert> : null}
        </CardBody>
      </Card>

      {canSubscribe ? (
        <Card>
          <CardHeader>
            <div>
              <h2 className="font-semibold">Assinar o Pro</h2>
              <p className="mt-1 text-sm text-fg-secondary">
                Assistente NORBIUS (até {PRO_AI_MESSAGES_PER_MONTH} mensagens por mês) e metas ilimitadas.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            {o.checkoutAvailable ? (
              <form
                method="post"
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const cpfCnpj = String(new FormData(e.currentTarget).get("cpfCnpj") ?? "");
                  void run("checkout", async () => {
                    const { invoiceUrl } = await api<{ invoiceUrl: string }>("/billing/checkout", { method: "POST", json: { cycle, cpfCnpj } });
                    window.location.assign(invoiceUrl);
                  });
                }}
              >
                <fieldset className="grid gap-3 sm:grid-cols-2">
                  <legend className="sr-only">Período</legend>
                  {(["monthly", "yearly"] as const).map((c) => (
                    <label
                      key={c}
                      className={cn(
                        "flex cursor-pointer flex-col rounded-xl border px-4 py-3 text-sm",
                        cycle === c ? "border-primary-dark bg-secondary" : "border-line hover:border-line-strong",
                      )}
                    >
                      <input type="radio" name="cycle" value={c} checked={cycle === c} onChange={() => setCycle(c)} className="sr-only" />
                      <span className="font-medium">{c === "monthly" ? "Mensal" : "Anual"}</span>
                      <span className="tabular text-fg-secondary">
                        {brl(o.prices[c])} {c === "monthly" ? "por mês" : `por ano · economize ${savings}%`}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <Field
                  label="CPF ou CNPJ"
                  name="cpfCnpj"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={18}
                  required
                  error={taxIdError}
                  hint="Exigido pelo meio de pagamento para emitir a cobrança. O NORBIUS não guarda esse número."
                />
                <Button type="submit" loading={loading === "checkout"} className="sm:self-start">
                  Continuar para o pagamento
                </Button>
                {error?.key === "checkout" ? <Alert tone="error">{error.message}</Alert> : null}
                <p className="text-xs text-fg-muted">
                  Você será levado ao Asaas para pagar com Pix, boleto ou cartão. O NORBIUS não recebe os dados do seu cartão.
                </p>
              </form>
            ) : (
              <p className="text-sm text-fg-secondary">
                As assinaturas ainda não estão disponíveis neste ambiente.{o.trialAvailable ? " Você já pode usar o teste grátis." : ""}
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {o.payments.length ? (
        <section aria-labelledby="historico">
          <h2 id="historico" className="mb-3 text-sm font-semibold">
            Histórico de cobranças
          </h2>
          <ul className="divide-y divide-line rounded-card border border-line bg-card">
            {o.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  {fullDate(p.dueDate)}
                  <span className="block text-xs text-fg-muted">{p.billingType ? (METHOD[p.billingType] ?? p.billingType) : "Forma de pagamento a escolher"}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular">{brl(p.amountCents)}</span>
                  <Badge tone={p.status === "paid" ? "success" : p.status === "overdue" ? "primary" : undefined}>{PAYMENT_STATUS[p.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancelar a assinatura?"
        description={
          o.proUntil && o.reason === "paid"
            ? `Não haverá novas cobranças. Você continua com o Pro até ${fullDate(o.proUntil)} e depois volta ao plano grátis, sem perder dados.`
            : "Não haverá novas cobranças. Seus dados continuam todos aqui."
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
            Manter assinatura
          </Button>
          <Button
            loading={loading === "cancel"}
            onClick={() =>
              run("cancel", async () => {
                await api("/billing/cancel", { method: "POST", json: {} });
                setConfirmCancel(false);
                router.refresh();
              })
            }
          >
            Confirmar cancelamento
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
