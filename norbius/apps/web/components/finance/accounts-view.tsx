"use client";
import { centsFrom, MoneyField } from "@/components/app/money-field";
import { useToast } from "@/components/app/toast";
import { api, ClientApiError } from "@/lib/client-api";
import { brl } from "@/lib/format";
import type { AccountView } from "@norbius/contracts";
import { ACCOUNT_TYPE_LABELS } from "@norbius/contracts";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, SelectField } from "@norbius/ui";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AccountsView({ accounts }: { accounts: AccountView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ editing: AccountView | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);
  const list = showArchived ? archived : active;
  const total = active.filter((a) => a.includeInAvailableBalance).reduce((s, a) => s + a.balanceCents, 0);

  async function toggleArchive(a: AccountView) {
    await api(`/accounts/${a.id}/${a.archived ? "unarchive" : "archive"}`, { method: "POST", json: {} });
    toast.show(a.archived ? "Conta reativada." : "Conta arquivada. O histórico foi mantido.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-fg-secondary">Saldo disponível</p>
          <p className="text-2xl font-semibold tabular">{brl(total)}</p>
        </div>
        <Button onClick={() => setDialog({ editing: null })}>
          <Plus aria-hidden className="size-4" /> Nova conta
        </Button>
      </div>

      {list.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((a) => (
            <Card key={a.id} className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="text-xs text-fg-muted">
                    {ACCOUNT_TYPE_LABELS[a.type]}
                    {a.institutionName ? ` · ${a.institutionName}` : ""}
                  </p>
                </div>
                {!a.includeInAvailableBalance ? <Badge>Fora do disponível</Badge> : null}
              </div>
              <p className="text-2xl font-semibold tabular">{brl(a.balanceCents)}</p>
              <div className="flex gap-2">
                {!a.archived ? (
                  <Button variant="secondary" size="sm" onClick={() => setDialog({ editing: a })}>
                    Editar
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => toggleArchive(a)}>
                  {a.archived ? "Reativar" : "Arquivar"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title={showArchived ? "Nenhuma conta arquivada" : "Nenhuma conta cadastrada"}
          description={showArchived ? undefined : "Cadastre onde seu dinheiro está: conta corrente, poupança, carteira ou investimentos."}
          action={showArchived ? undefined : <Button onClick={() => setDialog({ editing: null })}>Cadastrar conta</Button>}
        />
      )}

      {archived.length ? (
        <button type="button" onClick={() => setShowArchived((v) => !v)} className="self-start text-sm text-fg-secondary hover:text-fg">
          {showArchived ? "Ver contas ativas" : `Ver arquivadas (${archived.length})`}
        </button>
      ) : null}

      {dialog ? <AccountDialog editing={dialog.editing} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function AccountDialog({ editing, onClose }: { editing: AccountView | null; onClose: () => void }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const type = String(f.get("type"));
    const body = {
      name: f.get("name"),
      type,
      institutionName: f.get("institutionName") || null,
      initialBalanceCents: centsFrom(f, "initial") ?? 0,
      initialBalanceDate: f.get("initialBalanceDate") || undefined,
      includeInAvailableBalance: f.get("include") === "on",
    };
    setLoading(true);
    setErrors({});
    setFormError(undefined);
    try {
      await api(editing ? `/accounts/${editing.id}` : "/accounts", { method: editing ? "PUT" : "POST", json: body });
      onClose();
      router.refresh();
    } catch (err) {
      const fields = err instanceof ClientApiError ? err.body?.error.fields : undefined;
      if (fields) setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]!])));
      else setFormError("Não foi possível salvar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={editing ? "Editar conta" : "Nova conta"}>
      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Field label="Nome" name="name" defaultValue={editing?.name} maxLength={60} placeholder="Ex.: Nubank" error={errors.name} autoFocus />
        <SelectField
          label="Tipo"
          name="type"
          defaultValue={editing?.type ?? "checking"}
          options={Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <Field label="Instituição (opcional)" name="institutionName" defaultValue={editing?.institutionName ?? ""} maxLength={60} />
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Saldo inicial (R$)" name="initial" defaultCents={editing?.initialBalanceCents ?? null} allowNegative error={errors.initialBalanceCents} />
          <Field label="Na data" name="initialBalanceDate" type="date" defaultValue={editing?.initialBalanceDate} hint={editing ? undefined : "Padrão: hoje"} />
        </div>
        <label className="flex items-start gap-3 text-sm text-fg-secondary">
          <input type="checkbox" name="include" defaultChecked={editing ? editing.includeInAvailableBalance : true} className="mt-0.5 size-4 accent-primary" />
          Somar no saldo disponível (desmarque para reservas e investimentos)
        </label>
        <Button type="submit" loading={loading} className="mt-2 w-full">
          {editing ? "Salvar" : "Cadastrar conta"}
        </Button>
      </form>
    </Dialog>
  );
}
