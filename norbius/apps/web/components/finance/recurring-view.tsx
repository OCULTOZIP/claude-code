"use client";
import { centsFrom, MoneyField } from "@/components/app/money-field";
import { useToast } from "@/components/app/toast";
import type { TransactionDialogData } from "@/components/finance/transaction-dialog";
import { api, ClientApiError } from "@/lib/client-api";
import { brl, relativeDay } from "@/lib/format";
import type { RecurringView as Recurring } from "@norbius/contracts";
import { FREQUENCY_LABELS } from "@norbius/contracts";
import { Alert, Badge, Button, Card, cn, Dialog, EmptyState, Field, SelectField } from "@norbius/ui";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RecurringView({ items, data }: { items: Recurring[]; data: TransactionDialogData }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<{ item: Recurring | null } | null>(null);
  const [confirming, setConfirming] = useState<Recurring | null>(null);
  const active = items.filter((i) => i.active);
  const inactive = items.filter((i) => !i.active);
  const monthlyOut = active.filter((i) => i.type === "expense").reduce((s, i) => s + i.monthlyEquivalentCents, 0);
  const monthlyIn = active.filter((i) => i.type === "income").reduce((s, i) => s + i.monthlyEquivalentCents, 0);

  async function skip(item: Recurring) {
    await api(`/recurring/${item.id}/skip`, { method: "POST", json: { date: item.nextDate } });
    toast.show("Ocorrência pulada.");
    router.refresh();
  }

  async function toggle(item: Recurring) {
    await api(`/recurring/${item.id}/${item.active ? "deactivate" : "activate"}`, { method: "POST", json: {} });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-8">
          <div>
            <p className="text-sm text-fg-secondary">Saídas fixas por mês</p>
            <p className="text-2xl font-semibold tabular">{brl(monthlyOut)}</p>
          </div>
          <div>
            <p className="text-sm text-fg-secondary">Entradas previstas</p>
            <p className="text-2xl font-semibold tabular">{brl(monthlyIn)}</p>
          </div>
        </div>
        <Button onClick={() => setEditing({ item: null })}>
          <Plus aria-hidden className="size-4" /> Nova recorrência
        </Button>
      </div>

      {active.length ? (
        <Card>
          <ul className="divide-y divide-line">
            {active.map((i) => {
              const overdue = i.nextDate !== null && i.nextDate < data.today;
              const due = i.nextDate !== null && i.nextDate <= data.today;
              return (
                <li key={i.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      {i.description}
                      {i.type === "income" ? <Badge>Receita</Badge> : null}
                      {i.amountIsEstimate ? <Badge>Estimativa</Badge> : null}
                    </p>
                    <p className={cn("mt-0.5 text-xs", overdue ? "text-primary-light" : "text-fg-muted")}>
                      {FREQUENCY_LABELS[i.frequency]} · {i.category.name} · {i.account?.name ?? `Cartão ${i.creditCard?.name}`}
                      {i.nextDate ? ` · ${overdue ? "pendente desde" : "próxima"} ${relativeDay(i.nextDate, data.today).toLowerCase()}` : " · encerrada"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:shrink-0">
                    <span className="mr-2 text-sm tabular">{brl(i.amountCents)}</span>
                    {i.nextDate ? (
                      <Button size="sm" variant={due ? "primary" : "secondary"} onClick={() => setConfirming(i)}>
                        Registrar
                      </Button>
                    ) : null}
                    {i.nextDate ? (
                      <Button size="sm" variant="ghost" onClick={() => skip(i)}>
                        Pular
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ item: i })}>
                      Editar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <EmptyState
          title="Nenhuma recorrência"
          description="Cadastre aluguel, contas de consumo, assinaturas e salário para ver seus compromissos futuros."
          action={<Button onClick={() => setEditing({ item: null })}>Cadastrar</Button>}
        />
      )}

      {inactive.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-fg-secondary hover:text-fg">Pausadas ({inactive.length})</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {inactive.map((i) => (
              <li key={i.id} className="flex items-center justify-between rounded-xl border border-line px-4 py-2.5">
                <span className="text-fg-secondary">{i.description}</span>
                <Button size="sm" variant="ghost" onClick={() => toggle(i)}>
                  Reativar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {editing ? <RecurringDialog item={editing.item} data={data} onClose={() => setEditing(null)} onToggle={toggle} /> : null}
      {confirming ? <ConfirmDialog item={confirming} onClose={() => setConfirming(null)} /> : null}
    </div>
  );
}

function ConfirmDialog({ item, onClose }: { item: Recurring; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Registrar ${item.description}`}
      description={`Ocorrência de ${item.nextDate!.split("-").reverse().join("/")}. Ajuste o valor se ele foi diferente do previsto.`}
    >
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          setError(undefined);
          try {
            await api(`/recurring/${item.id}/confirm`, {
              method: "POST",
              json: { date: item.nextDate, amountCents: centsFrom(new FormData(e.currentTarget), "amount") },
            });
            toast.show(`${item.description} registrado.`);
            onClose();
            router.refresh();
          } catch (err) {
            setError(err instanceof ClientApiError ? err.message : "Não foi possível registrar.");
          } finally {
            setLoading(false);
          }
        }}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}
        <MoneyField label="Valor (R$)" name="amount" defaultCents={item.amountCents} autoFocus />
        <Button type="submit" loading={loading} className="w-full">
          Registrar {item.type === "income" ? "recebimento" : "pagamento"}
        </Button>
      </form>
    </Dialog>
  );
}

function RecurringDialog({
  item,
  data,
  onClose,
  onToggle,
}: {
  item: Recurring | null;
  data: TransactionDialogData;
  onClose: () => void;
  onToggle: (i: Recurring) => Promise<void>;
}) {
  const router = useRouter();
  const [type, setType] = useState<"income" | "expense">(item?.type ?? "expense");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const accounts = data.accounts.filter((a) => !a.archived);
  const cards = type === "expense" ? data.cards.filter((c) => !c.archived) : [];
  const targetOptions = [
    ...accounts.map((a) => ({ value: `a:${a.id}`, label: a.name })),
    ...cards.map((c) => ({ value: `c:${c.id}`, label: `Cartão ${c.name}` })),
  ];
  const currentTarget = item?.account ? `a:${item.account.id}` : item?.creditCard ? `c:${item.creditCard.id}` : targetOptions[0]?.value;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const target = String(f.get("target") ?? "");
    const day = Number(f.get("dayOfMonth"));
    const body = {
      type,
      accountId: target.startsWith("a:") ? target.slice(2) : null,
      creditCardId: target.startsWith("c:") ? target.slice(2) : null,
      amountCents: centsFrom(f, "amount"),
      amountIsEstimate: f.get("estimate") === "on",
      categoryId: f.get("categoryId"),
      description: f.get("description"),
      frequency: f.get("frequency"),
      dayOfMonth: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
      startDate: f.get("startDate"),
      endDate: f.get("endDate") || null,
    };
    setLoading(true);
    setErrors({});
    setFormError(undefined);
    try {
      await api(item ? `/recurring/${item.id}` : "/recurring", { method: item ? "PUT" : "POST", json: body });
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
    <Dialog open onClose={onClose} title={item ? "Editar recorrência" : "Nova recorrência"}>
      {!targetOptions.length ? (
        <Alert>Cadastre uma conta antes de criar recorrências.</Alert>
      ) : (
        <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4" key={type}>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
            {(["expense", "income"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={type === t}
                onClick={() => setType(t)}
                className={cn("rounded-lg py-2 text-sm font-medium", type === t ? "bg-secondary text-fg" : "text-fg-secondary")}
              >
                {t === "expense" ? "Conta fixa" : "Receita recorrente"}
              </button>
            ))}
          </div>
          <Field label="Descrição" name="description" defaultValue={item?.description} maxLength={140} placeholder={type === "income" ? "Ex.: Salário" : "Ex.: Aluguel"} error={errors.description} />
          <div className="grid grid-cols-2 gap-3">
            <MoneyField label="Valor (R$)" name="amount" defaultCents={item?.amountCents ?? null} error={errors.amountCents} />
            <SelectField
              label="Categoria"
              name="categoryId"
              defaultValue={item?.category.id ?? ""}
              placeholder="Escolha"
              options={data.categories.filter((c) => c.kind === type).map((c) => ({ value: c.id, label: c.name }))}
              error={errors.categoryId}
            />
          </div>
          <SelectField label={type === "income" ? "Recebe em" : "Paga com"} name="target" defaultValue={currentTarget} options={targetOptions} error={errors.accountId ?? errors.creditCardId} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Frequência"
              name="frequency"
              defaultValue={item?.frequency ?? "monthly"}
              options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))}
            />
            <Field label="Dia do mês" name="dayOfMonth" inputMode="numeric" defaultValue={item?.dayOfMonth ?? ""} hint="Mensal/anual" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Começa em" name="startDate" type="date" defaultValue={item?.startDate ?? data.today} error={errors.startDate} />
            <Field label="Termina em (opcional)" name="endDate" type="date" defaultValue={item?.endDate ?? ""} error={errors.endDate} />
          </div>
          <label className="flex items-start gap-3 text-sm text-fg-secondary">
            <input type="checkbox" name="estimate" defaultChecked={item?.amountIsEstimate ?? false} className="mt-0.5 size-4 accent-primary" />
            O valor varia (tratar como estimativa)
          </label>
          <Button type="submit" loading={loading} className="mt-1 w-full">
            {item ? "Salvar" : "Cadastrar"}
          </Button>
          {item ? (
            <Button
              variant="ghost"
              onClick={async () => {
                await onToggle(item);
                onClose();
              }}
            >
              Pausar recorrência
            </Button>
          ) : null}
        </form>
      )}
    </Dialog>
  );
}
