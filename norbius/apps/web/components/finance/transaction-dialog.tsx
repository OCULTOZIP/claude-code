"use client";
import { centsFrom, MoneyField } from "@/components/app/money-field";
import { useToast } from "@/components/app/toast";
import { api, ClientApiError } from "@/lib/client-api";
import type { AccountView, CategoryView, CreditCardView, TransactionView } from "@norbius/contracts";
import { PAYMENT_METHOD_LABELS } from "@norbius/contracts";
import { Alert, Button, cn, Dialog, Field, SelectField } from "@norbius/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "expense" | "income" | "transfer" | "card";
type FieldErrors = Record<string, string | undefined>;

const MODE_LABEL: Record<Mode, string> = { expense: "Despesa", income: "Receita", transfer: "Transferência", card: "Cartão" };
const INSTALLMENTS = Array.from({ length: 24 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "À vista" : `${i + 1}x` }));

export type TransactionDialogData = {
  accounts: AccountView[];
  categories: CategoryView[];
  cards: CreditCardView[];
  today: string;
};

function fieldErrors(err: unknown): { fields: FieldErrors; message?: string } {
  if (err instanceof ClientApiError && err.body) {
    const f = err.body.error.fields;
    if (f) return { fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v[0]])) };
    return { fields: {}, message: err.body.error.message };
  }
  return { fields: {}, message: "Não foi possível salvar. Tente novamente." };
}

/**
 * Registro e edição de movimentações: receita, despesa, transferência e compra
 * no cartão (com parcelas). Após criar, oferece "Desfazer".
 */
export function TransactionDialog({
  open,
  onClose,
  data,
  editing,
  initialMode,
}: {
  open: boolean;
  onClose: () => void;
  data: TransactionDialogData;
  editing?: TransactionView | null;
  initialMode?: Mode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(editing ? (editing.type as Mode) : (initialMode ?? "expense"));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const accounts = data.accounts.filter((a) => !a.archived);
  const cards = data.cards.filter((c) => !c.archived);
  const modes: Mode[] = editing ? [editing.type as Mode] : ["expense", "income", "transfer", ...(cards.length ? (["card"] as const) : [])];
  const categoryKind = mode === "income" ? "income" : "expense";
  const categories = data.categories.filter((c) => c.kind === categoryKind);

  if (!accounts.length && mode !== "card" && !cards.length) {
    return (
      <Dialog open={open} onClose={onClose} title="Registrar movimentação">
        <Alert>Cadastre uma conta antes de registrar movimentações.</Alert>
        <Button className="mt-5" onClick={() => router.push("/contas")}>
          Ir para Contas
        </Button>
      </Dialog>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setFormError(undefined);
    const f = new FormData(e.currentTarget);
    const amountCents = centsFrom(f, "amount");
    const common = { description: String(f.get("description") ?? ""), date: String(f.get("date") ?? "") };
    setLoading(true);
    try {
      if (mode === "card") {
        const created = await api<{ id: string }>("/card-purchases", {
          method: "POST",
          json: {
            creditCardId: f.get("creditCardId"),
            description: common.description,
            totalAmountCents: amountCents,
            installmentCount: Number(f.get("installments") ?? 1),
            purchaseDate: common.date,
            categoryId: f.get("categoryId"),
          },
        });
        toast.show("Compra registrada no cartão.", {
          label: "Desfazer",
          onClick: async () => {
            await api(`/card-purchases/${created.id}`, { method: "DELETE" });
            router.refresh();
          },
        });
      } else {
        const body =
          mode === "transfer"
            ? { type: "transfer", accountId: f.get("accountId"), transferAccountId: f.get("transferAccountId"), amountCents, ...common }
            : {
                type: mode,
                accountId: f.get("accountId"),
                categoryId: f.get("categoryId"),
                amountCents,
                paymentMethod: f.get("paymentMethod") || null,
                ...common,
              };
        if (editing) {
          await api(`/transactions/${editing.id}`, { method: "PUT", json: body });
          toast.show("Movimentação atualizada.");
        } else {
          const created = await api<TransactionView>("/transactions", { method: "POST", json: body });
          toast.show(`${MODE_LABEL[mode]} registrada.`, {
            label: "Desfazer",
            onClick: async () => {
              await api(`/transactions/${created.id}`, { method: "DELETE" });
              router.refresh();
            },
          });
        }
      }
      onClose();
      router.refresh();
    } catch (err) {
      const { fields, message } = fieldErrors(err);
      setErrors({ ...fields, amount: fields.amountCents ?? fields.totalAmountCents });
      setFormError(message);
    } finally {
      setLoading(false);
    }
  }

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Editar movimentação" : "Registrar movimentação"}>
      {modes.length > 1 ? (
        <div role="tablist" aria-label="Tipo" className="mb-6 grid grid-cols-4 gap-1 rounded-xl bg-surface p-1">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setErrors({});
              }}
              className={cn(
                "rounded-lg py-2 text-xs font-medium transition-colors sm:text-sm",
                mode === m ? "bg-secondary text-fg" : "text-fg-secondary hover:text-fg",
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      ) : null}

      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4" key={mode}>
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <MoneyField label="Valor (R$)" name="amount" defaultCents={editing?.amountCents ?? null} error={errors.amount} autoFocus />
        <Field
          label="Descrição"
          name="description"
          defaultValue={editing?.description ?? ""}
          maxLength={140}
          placeholder={mode === "income" ? "Ex.: Salário" : mode === "transfer" ? "Opcional" : "Ex.: Mercado"}
          error={errors.description}
        />
        {mode !== "transfer" ? (
          <SelectField
            label="Categoria"
            name="categoryId"
            defaultValue={editing?.category?.id ?? ""}
            placeholder="Escolha uma categoria"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            error={errors.categoryId}
          />
        ) : null}
        {mode === "card" ? (
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Cartão" name="creditCardId" defaultValue={cards[0]?.id} options={cards.map((c) => ({ value: c.id, label: c.name }))} error={errors.creditCardId} />
            <SelectField label="Parcelas" name="installments" defaultValue="1" options={INSTALLMENTS} error={errors.installmentCount} />
          </div>
        ) : (
          <div className={cn("grid gap-3", mode === "transfer" && "grid-cols-2")}>
            <SelectField
              label={mode === "transfer" ? "De" : "Conta"}
              name="accountId"
              defaultValue={editing?.account.id ?? accounts[0]?.id}
              options={accountOptions}
              error={errors.accountId}
            />
            {mode === "transfer" ? (
              <SelectField
                label="Para"
                name="transferAccountId"
                defaultValue={editing?.transferAccount?.id ?? accounts[1]?.id ?? ""}
                placeholder="Conta de destino"
                options={accountOptions}
                error={errors.transferAccountId}
              />
            ) : null}
          </div>
        )}
        <div className={cn("grid gap-3", mode === "expense" && "grid-cols-2")}>
          <Field label="Data" name="date" type="date" defaultValue={editing?.date ?? data.today} error={errors.date ?? errors.purchaseDate} />
          {mode === "expense" ? (
            <SelectField
              label="Pagamento"
              name="paymentMethod"
              defaultValue={editing?.paymentMethod ?? ""}
              options={[{ value: "", label: "Não informar" }, ...(["pix", "debit", "cash", "boleto", "transfer", "other"] as const).map((k) => ({ value: k, label: PAYMENT_METHOD_LABELS[k] }))]}
            />
          ) : null}
        </div>
        <Button type="submit" loading={loading} className="mt-2 w-full">
          {editing ? "Salvar alterações" : "Registrar"}
        </Button>
      </form>
    </Dialog>
  );
}
