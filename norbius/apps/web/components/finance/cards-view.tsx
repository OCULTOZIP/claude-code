"use client";
import { centsFrom, MoneyField } from "@/components/app/money-field";
import { TransactionDialog, type TransactionDialogData } from "@/components/finance/transaction-dialog";
import { api, ClientApiError } from "@/lib/client-api";
import { brl, shortDate } from "@/lib/format";
import type { CreditCardView } from "@norbius/contracts";
import { Alert, Button, Card, Dialog, EmptyState, Field, Progress, SelectField } from "@norbius/ui";
import { CreditCard, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InvoiceStatusBadge } from "./invoice-status";

export function CardsView({ cards, data }: { cards: CreditCardView[]; data: TransactionDialogData }) {
  const [cardDialog, setCardDialog] = useState<{ editing: CreditCardView | null } | null>(null);
  const [purchase, setPurchase] = useState(false);
  const active = cards.filter((c) => !c.archived);
  const archived = cards.filter((c) => c.archived);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Cartões</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCardDialog({ editing: null })}>
            <CreditCard aria-hidden className="size-4" /> Novo cartão
          </Button>
          {active.length ? (
            <Button onClick={() => setPurchase(true)}>
              <Plus aria-hidden className="size-4" /> Nova compra
            </Button>
          ) : null}
        </div>
      </div>

      {active.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {active.map((c) => {
            const usage = c.limitCents ? c.usedLimitCents / c.limitCents : 0;
            return (
              <Card key={c.id} className="flex flex-col gap-5 p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-fg-muted">
                      Fecha dia {c.closingDay} · vence dia {c.dueDay}
                      {c.lastFour ? ` · final ${c.lastFour}` : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setCardDialog({ editing: c })}>
                    Editar
                  </Button>
                </div>
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-fg-secondary">Limite disponível</span>
                    <span className="font-medium tabular">{brl(c.availableLimitCents)}</span>
                  </div>
                  <Progress value={usage} tone={usage >= 0.9 ? "primary" : "fg"} className="mt-2" />
                  <p className="mt-1.5 text-xs text-fg-muted tabular">
                    {brl(c.usedLimitCents)} usados de {brl(c.limitCents)} (inclui parcelas futuras)
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
                  {c.currentInvoice ? (
                    <div>
                      <p className="flex items-center gap-2 text-sm">
                        Fatura atual <InvoiceStatusBadge status={c.currentInvoice.status} />
                      </p>
                      <p className="text-xs text-fg-muted">
                        {brl(c.currentInvoice.totalCents)} · fecha {shortDate(c.currentInvoice.closingDate)} · vence {shortDate(c.currentInvoice.dueDate)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-fg-muted">Sem compras na fatura atual.</p>
                  )}
                  <Link href={`/cartoes/${c.id}`} className="shrink-0 text-sm text-fg-secondary hover:text-fg">
                    Faturas →
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Nenhum cartão cadastrado"
          description="Cadastre seus cartões para acompanhar limite, faturas e parcelas."
          action={<Button onClick={() => setCardDialog({ editing: null })}>Cadastrar cartão</Button>}
        />
      )}

      {archived.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-fg-secondary hover:text-fg">Arquivados ({archived.length})</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-xl border border-line px-4 py-2.5">
                <span className="text-fg-secondary">{c.name}</span>
                <ArchiveButton card={c} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {cardDialog ? <CardDialog editing={cardDialog.editing} data={data} onClose={() => setCardDialog(null)} /> : null}
      {purchase ? <TransactionDialog open onClose={() => setPurchase(false)} data={data} initialMode="card" /> : null}
    </div>
  );
}

function ArchiveButton({ card }: { card: CreditCardView }) {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await api(`/cards/${card.id}/${card.archived ? "unarchive" : "archive"}`, { method: "POST", json: {} });
        router.refresh();
      }}
    >
      {card.archived ? "Reativar" : "Arquivar cartão"}
    </Button>
  );
}

function CardDialog({ editing, data, onClose }: { editing: CreditCardView | null; data: TransactionDialogData; onClose: () => void }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const accounts = data.accounts.filter((a) => !a.archived);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"),
      brand: f.get("brand") || null,
      lastFour: f.get("lastFour") || null,
      limitCents: centsFrom(f, "limit"),
      closingDay: Number(f.get("closingDay")),
      dueDay: Number(f.get("dueDay")),
      defaultPaymentAccountId: f.get("account") || null,
    };
    setLoading(true);
    setErrors({});
    setFormError(undefined);
    try {
      await api(editing ? `/cards/${editing.id}` : "/cards", { method: editing ? "PUT" : "POST", json: body });
      onClose();
      router.refresh();
    } catch (err) {
      const fields = err instanceof ClientApiError ? err.body?.error.fields : undefined;
      if (fields) setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]!])));
      else setFormError(err instanceof ClientApiError ? err.message : "Não foi possível salvar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={editing ? "Editar cartão" : "Novo cartão"}>
      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Field label="Nome" name="name" defaultValue={editing?.name} maxLength={60} placeholder="Ex.: Nubank" error={errors.name} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Limite (R$)" name="limit" defaultCents={editing?.limitCents ?? null} error={errors.limitCents} />
          <Field label="4 últimos dígitos" name="lastFour" inputMode="numeric" maxLength={4} defaultValue={editing?.lastFour ?? ""} error={errors.lastFour} hint="Opcional" />
          <Field label="Dia do fechamento" name="closingDay" inputMode="numeric" defaultValue={editing?.closingDay ?? ""} error={errors.closingDay} />
          <Field label="Dia do vencimento" name="dueDay" inputMode="numeric" defaultValue={editing?.dueDay ?? ""} error={errors.dueDay} />
        </div>
        <Field label="Bandeira (opcional)" name="brand" defaultValue={editing?.brand ?? ""} maxLength={30} />
        {accounts.length ? (
          <SelectField
            label="Conta que paga a fatura"
            name="account"
            defaultValue={editing?.defaultPaymentAccountId ?? accounts[0]?.id}
            options={[{ value: "", label: "Não definir" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
        ) : null}
        {editing ? <p className="text-xs text-fg-muted">Mudanças nos dias valem para as próximas faturas.</p> : null}
        <Button type="submit" loading={loading} className="mt-1 w-full">
          {editing ? "Salvar" : "Cadastrar cartão"}
        </Button>
        {editing ? <ArchiveButton card={editing} /> : null}
      </form>
    </Dialog>
  );
}
