"use client";
import { centsFrom, MoneyField } from "@/components/app/money-field";
import { useToast } from "@/components/app/toast";
import { api, ClientApiError } from "@/lib/client-api";
import { brl, shortDate } from "@/lib/format";
import type { ContributionView, GoalView } from "@norbius/contracts";
import { Alert, Badge, Button, Card, cn, Dialog, EmptyState, Field, Progress } from "@norbius/ui";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function GoalsView({ goals, today }: { goals: GoalView[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<{ goal: GoalView | null } | null>(null);
  const [contributing, setContributing] = useState<GoalView | null>(null);
  const visible = goals.filter((g) => g.status !== "archived");
  const archived = goals.filter((g) => g.status === "archived");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Metas</h1>
        <Button onClick={() => setEditing({ goal: null })}>
          <Plus aria-hidden className="size-4" /> Nova meta
        </Button>
      </div>

      {visible.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((g) => (
            <GoalCard key={g.id} goal={g} onContribute={() => setContributing(g)} onEdit={() => setEditing({ goal: g })} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nenhuma meta ainda"
          description="Defina um objetivo — reserva de emergência, viagem, entrada de um imóvel — e acompanhe cada aporte."
          action={<Button onClick={() => setEditing({ goal: null })}>Criar meta</Button>}
        />
      )}

      {archived.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-fg-secondary hover:text-fg">Arquivadas ({archived.length})</summary>
          <ul className="mt-3 flex flex-col gap-2">
            {archived.map((g) => (
              <li key={g.id} className="flex items-center justify-between rounded-xl border border-line px-4 py-2.5">
                <span className="text-fg-secondary">{g.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await api(`/goals/${g.id}/unarchive`, { method: "POST", json: {} });
                      router.refresh();
                    } catch (err) {
                      toast.show(err instanceof ClientApiError ? err.message : "Não foi possível reativar.");
                    }
                  }}
                >
                  Reativar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {editing ? <GoalDialog goal={editing.goal} onClose={() => setEditing(null)} /> : null}
      {contributing ? <ContributionDialog goal={contributing} today={today} onClose={() => setContributing(null)} /> : null}
    </div>
  );
}

function GoalCard({ goal: g, onContribute, onEdit }: { goal: GoalView; onContribute: () => void; onEdit: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [history, setHistory] = useState<ContributionView[] | null>(null);
  const [open, setOpen] = useState(false);

  async function toggleHistory() {
    if (!open && !history) setHistory(await api<ContributionView[]>(`/goals/${g.id}/contributions`));
    setOpen((v) => !v);
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{g.name}</p>
          <p className="text-xs text-fg-muted">{g.targetDate ? `Prazo: ${shortDate(g.targetDate)}` : "Sem prazo"}</p>
        </div>
        {g.status === "completed" ? <Badge tone="success">Atingida</Badge> : null}
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-2xl font-semibold tabular">{brl(g.currentAmountCents)}</span>
          <span className="text-sm text-fg-secondary tabular">{Math.round(g.progress * 100)}%</span>
        </div>
        <Progress value={g.progress} tone={g.status === "completed" ? "success" : "primary"} className="mt-2" />
        <p className="mt-1.5 text-xs text-fg-muted tabular">
          de {brl(g.targetAmountCents)}
          {g.monthlyNeededCents ? ` · cerca de ${brl(g.monthlyNeededCents)}/mês para chegar no prazo (estimativa)` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onContribute}>
          Registrar aporte
        </Button>
        <Button size="sm" variant="secondary" onClick={onEdit}>
          Editar
        </Button>
        <Button size="sm" variant="ghost" onClick={toggleHistory} aria-expanded={open}>
          Histórico
        </Button>
      </div>
      {open && history ? (
        history.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {history.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="text-fg-secondary">
                  {shortDate(c.date)}
                  {c.note ? ` · ${c.note}` : ""}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular">{c.amountCents > 0 ? "+ " : "− "}{brl(Math.abs(c.amountCents))}</span>
                  <button
                    type="button"
                    className="text-xs text-fg-muted hover:text-primary-light"
                    onClick={async () => {
                      await api(`/goals/${g.id}/contributions/${c.id}`, { method: "DELETE" });
                      setHistory(history.filter((x) => x.id !== c.id));
                      toast.show("Aporte removido.");
                      router.refresh();
                    }}
                  >
                    Remover
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">Nenhum aporte ainda.</p>
        )
      ) : null}
    </Card>
  );
}

function GoalDialog({ goal, onClose }: { goal: GoalView | null; onClose: () => void }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  return (
    <Dialog open onClose={onClose} title={goal ? "Editar meta" : "Nova meta"}>
      <form
        method="post"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setLoading(true);
          setErrors({});
          try {
            await api(goal ? `/goals/${goal.id}` : "/goals", {
              method: goal ? "PUT" : "POST",
              json: { name: f.get("name"), targetAmountCents: centsFrom(f, "target"), targetDate: f.get("targetDate") || null },
            });
            onClose();
            router.refresh();
          } catch (err) {
            const fields = err instanceof ClientApiError ? err.body?.error.fields : undefined;
            setErrors(
              fields
                ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]!]))
                : { form: err instanceof ClientApiError ? err.message : "Não foi possível salvar." },
            );
          } finally {
            setLoading(false);
          }
        }}
      >
        <Field label="Nome da meta" name="name" defaultValue={goal?.name} maxLength={60} placeholder="Ex.: Reserva de emergência" error={errors.name} autoFocus />
        <MoneyField label="Valor objetivo (R$)" name="target" defaultCents={goal?.targetAmountCents ?? null} error={errors.targetAmountCents} />
        <Field label="Prazo (opcional)" name="targetDate" type="date" defaultValue={goal?.targetDate ?? ""} error={errors.targetDate} />
        {errors.form ? (
          <Alert tone="error">
            {errors.form}{" "}
            <Link href="/configuracoes/plano" className="underline">
              Ver planos
            </Link>
          </Alert>
        ) : null}
        <Button type="submit" loading={loading} className="mt-1 w-full">
          {goal ? "Salvar" : "Criar meta"}
        </Button>
        {goal ? (
          <Button
            variant="ghost"
            onClick={async () => {
              await api(`/goals/${goal.id}/archive`, { method: "POST", json: {} });
              onClose();
              router.refresh();
            }}
          >
            Arquivar meta
          </Button>
        ) : null}
      </form>
    </Dialog>
  );
}

function ContributionDialog({ goal, today, onClose }: { goal: GoalView; today: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [withdraw, setWithdraw] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  return (
    <Dialog open onClose={onClose} title={goal.name} description="Aportes registram quanto você já separou para esta meta.">
      <form
        method="post"
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const cents = centsFrom(f, "amount");
          if (!cents) return setError("Informe o valor.");
          setLoading(true);
          setError(undefined);
          try {
            const updated = await api<GoalView>(`/goals/${goal.id}/contributions`, {
              method: "POST",
              json: { amountCents: withdraw ? -cents : cents, date: f.get("date"), note: f.get("note") || null },
            });
            toast.show(updated.status === "completed" && goal.status !== "completed" ? "Meta atingida." : "Aporte registrado.");
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
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
          {[false, true].map((w) => (
            <button
              key={String(w)}
              type="button"
              role="tab"
              aria-selected={withdraw === w}
              onClick={() => setWithdraw(w)}
              className={cn("rounded-lg py-2 text-sm font-medium", withdraw === w ? "bg-secondary text-fg" : "text-fg-secondary")}
            >
              {w ? "Retirada" : "Aporte"}
            </button>
          ))}
        </div>
        <MoneyField label="Valor (R$)" name="amount" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data" name="date" type="date" defaultValue={today} />
          <Field label="Observação" name="note" maxLength={200} placeholder="Opcional" />
        </div>
        <Button type="submit" loading={loading} className="w-full">
          {withdraw ? "Registrar retirada" : "Registrar aporte"}
        </Button>
      </form>
    </Dialog>
  );
}
