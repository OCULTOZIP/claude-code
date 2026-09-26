"use client";
import { useToast } from "@/components/app/toast";
import { TransactionDialog, type TransactionDialogData } from "@/components/finance/transaction-dialog";
import { api } from "@/lib/client-api";
import { brl, monthLabel, relativeDay, signedBrl } from "@/lib/format";
import type { TransactionList, TransactionView } from "@norbius/contracts";
import { addMonthsToMonth } from "@norbius/domain";
import { Button, buttonClasses, Card, cn, EmptyState, inputClasses, selectClasses } from "@norbius/ui";
import { ChevronLeft, ChevronRight, Download, Plus, Search, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export function TransactionsView({
  list,
  filters,
  data,
}: {
  list: TransactionList;
  filters: Record<string, string>;
  data: TransactionDialogData;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [dialog, setDialog] = useState<{ editing: TransactionView | null } | null>(null);
  const [q, setQ] = useState(filters.q ?? "");

  function go(patch: Record<string, string | undefined>) {
    const next = { ...filters, ...patch };
    if (!("page" in patch)) delete next.page;
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    router.push(`${pathname}?${qs.toString()}`);
  }

  async function remove(t: TransactionView) {
    await api(`/transactions/${t.id}`, { method: "DELETE" });
    router.refresh();
    toast.show("Movimentação excluída.", {
      label: "Desfazer",
      onClick: async () => {
        await api(`/transactions/${t.id}/restore`, { method: "POST", json: {} });
        router.refresh();
      },
    });
  }

  const month = filters.month!;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const exportQs = new URLSearchParams(Object.entries(filters).filter(([k]) => k !== "page" && k !== "sort"));
  const categoryOptions = data.categories;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Transações</h1>
        <div className="flex gap-2">
          <a href={`/api/v1/transactions/export.csv?${exportQs.toString()}`} className={buttonClasses({ variant: "secondary" })}>
            <Download aria-hidden className="size-4" /> CSV
          </a>
          <Button onClick={() => setDialog({ editing: null })}>
            <Plus aria-hidden className="size-4" /> Registrar
          </Button>
        </div>
      </div>

      {/* Filtros: uma linha acima do conteúdo; o mês vem primeiro. */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Mês anterior" onClick={() => go({ month: addMonthsToMonth(month, -1) })} className="grid size-10 place-items-center rounded-xl border border-line-strong hover:bg-secondary">
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <p className="min-w-40 text-center font-medium">{monthLabel(month)}</p>
          <button type="button" aria-label="Próximo mês" onClick={() => go({ month: addMonthsToMonth(month, 1) })} className="grid size-10 place-items-center rounded-xl border border-line-strong hover:bg-secondary">
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <form
            className="relative col-span-2 lg:col-span-1"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q: q.trim() || undefined });
            }}
          >
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
            <input aria-label="Buscar" placeholder="Buscar descrição" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} className={cn(inputClasses, "pl-9")} />
          </form>
          <select aria-label="Tipo" className={selectClasses} value={filters.type ?? ""} onChange={(e) => go({ type: e.target.value || undefined })}>
            <option value="">Todos os tipos</option>
            <option value="income">Receitas</option>
            <option value="expense">Despesas</option>
            <option value="transfer">Transferências</option>
          </select>
          <select aria-label="Conta" className={selectClasses} value={filters.accountId ?? ""} onChange={(e) => go({ accountId: e.target.value || undefined })}>
            <option value="">Todas as contas</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select aria-label="Categoria" className={selectClasses} value={filters.categoryId ?? ""} onChange={(e) => go({ categoryId: e.target.value || undefined })}>
            <option value="">Todas as categorias</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.kind === "income" ? "receita" : "despesa"})
              </option>
            ))}
          </select>
          <select aria-label="Ordenar" className={selectClasses} value={filters.sort ?? "date_desc"} onChange={(e) => go({ sort: e.target.value })}>
            <option value="date_desc">Mais recentes</option>
            <option value="date_asc">Mais antigas</option>
            <option value="amount_desc">Maior valor</option>
            <option value="amount_asc">Menor valor</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="px-5 py-4">
          <p className="text-xs text-fg-muted">Receitas no filtro</p>
          <p className="mt-1 text-lg font-semibold tabular">{brl(list.totals.incomeCents)}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs text-fg-muted">Despesas no filtro</p>
          <p className="mt-1 text-lg font-semibold tabular">{brl(list.totals.expenseCents)}</p>
        </Card>
      </div>
      <p className="-mt-3 text-xs text-fg-muted">Compras no cartão aparecem na tela de cada cartão.</p>

      {list.items.length ? (
        <Card>
          <ul className="divide-y divide-line">
            {list.items.map((t) => (
              <li key={t.id} className="group flex items-center gap-3 px-4 py-3 sm:px-6">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                  onClick={() => (t.creditCardInvoiceId ? router.push("/cartoes") : setDialog({ editing: t }))}
                  aria-label={`Editar ${t.description}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{t.description}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {relativeDay(t.date, data.today)} · {t.category?.name ?? (t.creditCardInvoiceId ? "Pagamento de fatura" : "Transferência")} ·{" "}
                      {t.transferAccount ? `${t.account.name} → ${t.transferAccount.name}` : t.account.name}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular">{signedBrl(t.amountCents, t.type)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(t)}
                  aria-label={`Excluir ${t.description}`}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted opacity-100 hover:bg-secondary hover:text-primary-light sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState
          title="Nenhuma movimentação encontrada"
          description={filters.q || filters.type || filters.accountId || filters.categoryId ? "Tente ajustar os filtros." : `Nada registrado em ${monthLabel(month).toLowerCase()}.`}
          action={<Button onClick={() => setDialog({ editing: null })}>Registrar movimentação</Button>}
        />
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button variant="secondary" size="sm" disabled={list.page <= 1} onClick={() => go({ page: String(list.page - 1) })}>
            Anterior
          </Button>
          <span className="text-fg-secondary tabular">
            {list.page} de {pages}
          </span>
          <Button variant="secondary" size="sm" disabled={list.page >= pages} onClick={() => go({ page: String(list.page + 1) })}>
            Próxima
          </Button>
        </div>
      ) : null}

      {dialog ? <TransactionDialog open onClose={() => setDialog(null)} data={data} editing={dialog.editing} /> : null}
    </div>
  );
}
