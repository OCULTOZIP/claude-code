"use client";
import { centsFrom, MoneyField } from "@/components/app/money-field";
import { useToast } from "@/components/app/toast";
import type { TransactionDialogData } from "@/components/finance/transaction-dialog";
import { api, ClientApiError } from "@/lib/client-api";
import { brl, monthLabel, shortDate } from "@/lib/format";
import type { CreditCardView, InvoiceItemView, InvoiceView as Invoice } from "@norbius/contracts";
import { Alert, Button, Card, CardBody, cn, Dialog, EmptyState, Field, SelectField } from "@norbius/ui";
import { ArrowLeft, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InvoiceStatusBadge } from "./invoice-status";

export function InvoiceView({
  card,
  invoices,
  detail,
  data,
}: {
  card: CreditCardView;
  invoices: Invoice[];
  detail: { invoice: Invoice; items: InvoiceItemView[] } | null;
  data: TransactionDialogData;
}) {
  const router = useRouter();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const sorted = [...invoices].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth));

  async function removePurchase(item: InvoiceItemView) {
    await api(`/card-purchases/${item.purchaseId}`, { method: "DELETE" });
    router.refresh();
    toast.show(item.installmentCount > 1 ? "Compra e todas as parcelas excluídas." : "Compra excluída.", {
      label: "Desfazer",
      onClick: async () => {
        await api(`/card-purchases/${item.purchaseId}/restore`, { method: "POST", json: {} });
        router.refresh();
      },
    });
  }

  const inv = detail?.invoice;
  const remaining = inv ? inv.totalCents - inv.paidCents : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/cartoes" className="inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg">
          <ArrowLeft aria-hidden className="size-4" /> Cartões
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{card.name}</h1>
        <p className="text-sm text-fg-muted">
          Limite disponível {brl(card.availableLimitCents)} de {brl(card.limitCents)}
        </p>
      </div>

      {sorted.length ? (
        <nav aria-label="Faturas" className="flex gap-2 overflow-x-auto pb-1">
          {sorted.map((i) => (
            <Link
              key={i.id}
              href={`/cartoes/${card.id}?fatura=${i.id}`}
              aria-current={i.id === inv?.id ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-xl border px-4 py-2 text-sm transition-colors",
                i.id === inv?.id ? "border-primary bg-primary/10 text-fg" : "border-line-strong text-fg-secondary hover:text-fg",
              )}
            >
              {monthLabel(i.referenceMonth)}
            </Link>
          ))}
        </nav>
      ) : null}

      {inv ? (
        <>
          <Card>
            <CardBody className="flex flex-col gap-5 pt-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-sm text-fg-secondary">
                  Fatura de {monthLabel(inv.referenceMonth).toLowerCase()} <InvoiceStatusBadge status={inv.status} />
                </p>
                <p className="mt-1 text-3xl font-semibold tabular">{brl(inv.totalCents)}</p>
                <p className="mt-1 text-xs text-fg-muted">
                  Fecha {shortDate(inv.closingDate)} · vence {shortDate(inv.dueDate)}
                  {inv.paidCents ? ` · pago ${brl(inv.paidCents)}` : ""}
                  {inv.status === "open" ? " · ainda pode receber compras" : ""}
                </p>
              </div>
              {remaining > 0 ? <Button onClick={() => setPaying(true)}>Pagar fatura</Button> : null}
            </CardBody>
          </Card>

          {detail!.items.length ? (
            <Card>
              <ul className="divide-y divide-line">
                {detail!.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{item.description}</p>
                      <p className="text-xs text-fg-muted">
                        {shortDate(item.purchaseDate)} · {item.category.name}
                        {item.installmentCount > 1 ? ` · parcela ${item.installmentNumber}/${item.installmentCount}` : ""}
                      </p>
                    </div>
                    <span className="text-sm tabular">{brl(item.amountCents)}</span>
                    <button
                      type="button"
                      onClick={() => removePurchase(item)}
                      aria-label={`Excluir ${item.description}`}
                      className="grid size-8 place-items-center rounded-lg text-fg-muted hover:bg-secondary hover:text-primary-light"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <p className="text-sm text-fg-muted">Nenhuma compra nesta fatura.</p>
          )}
        </>
      ) : (
        <EmptyState title="Nenhuma fatura ainda" description="As faturas aparecem aqui assim que você registrar a primeira compra neste cartão." />
      )}

      {paying && inv ? <PayDialog invoice={inv} card={card} data={data} remaining={remaining} onClose={() => setPaying(false)} /> : null}
    </div>
  );
}

function PayDialog({
  invoice,
  card,
  data,
  remaining,
  onClose,
}: {
  invoice: Invoice;
  card: CreditCardView;
  data: TransactionDialogData;
  remaining: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const accounts = data.accounts.filter((a) => !a.archived);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Pagar fatura"
      description="O pagamento sai da conta escolhida e libera o limite do cartão. Ele não conta como nova despesa — as compras já foram contadas."
    >
      {!accounts.length ? (
        <Alert>Cadastre uma conta para registrar o pagamento.</Alert>
      ) : (
        <form
          method="post"
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setLoading(true);
            setError(undefined);
            try {
              await api(`/invoices/${invoice.id}/payments`, {
                method: "POST",
                json: { accountId: f.get("accountId"), amountCents: centsFrom(f, "amount"), date: f.get("date") },
              });
              toast.show("Pagamento registrado.");
              onClose();
              router.refresh();
            } catch (err) {
              setError(err instanceof ClientApiError ? err.message : "Não foi possível registrar o pagamento.");
            } finally {
              setLoading(false);
            }
          }}
        >
          {error ? <Alert tone="error">{error}</Alert> : null}
          <MoneyField label="Valor (R$)" name="amount" defaultCents={remaining} hint={`Em aberto: ${brl(remaining)}`} />
          <SelectField
            label="Pagar com"
            name="accountId"
            defaultValue={card.defaultPaymentAccountId ?? accounts[0]!.id}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${brl(a.balanceCents)}` }))}
          />
          <Field label="Data do pagamento" name="date" type="date" defaultValue={data.today} />
          <Button type="submit" loading={loading} className="w-full">
            Registrar pagamento
          </Button>
        </form>
      )}
    </Dialog>
  );
}
