"use client";
import { api, ClientApiError } from "@/lib/client-api";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@norbius/ui";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

export type Grant = { id: string; reason: string; grantedAt: string; expiresAt: string; revokedAt: string | null; active: boolean };

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** O usuário decide se, por quanto tempo e por que o suporte pode ver suas transações (ADR 0007). */
export function SupportGrants({ initial }: { initial: Grant[] }) {
  const [grants, setGrants] = useState(initial);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const active = grants.find((g) => g.active);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setStatus(null);
    try {
      const g = await api<Grant>("/support/grants", { method: "POST", json: { reason: f.get("reason"), hours: Number(f.get("hours")) } });
      setGrants((list) => [g, ...list.map((x) => (x.active ? { ...x, active: false, revokedAt: new Date().toISOString() } : x))]);
      setStatus({ tone: "success", text: `Acesso autorizado até ${when(g.expiresAt)}.` });
      e.currentTarget?.reset();
    } catch (err) {
      setStatus({ tone: "error", text: err instanceof ClientApiError ? err.message : "Não foi possível autorizar agora." });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await api(`/support/grants/${id}/revoke`, { method: "POST", json: {} });
      setGrants((list) => list.map((x) => (x.id === id ? { ...x, active: false, revokedAt: new Date().toISOString() } : x)));
      setStatus({ tone: "success", text: "Acesso revogado. O suporte não consegue mais ver suas transações." });
    } catch {
      setStatus({ tone: "error", text: "Não foi possível revogar agora." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardBody className="flex gap-3 pt-6">
          <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-secondary" />
          <div className="text-sm leading-relaxed text-fg-secondary">
            <p className="font-medium text-fg">A equipe do NORBIUS não vê seus dados financeiros.</p>
            <p className="mt-1">
              Se você precisar de ajuda com um problema nos seus lançamentos, pode autorizar o suporte a <strong className="text-fg">ver suas transações</strong>{" "}
              por um tempo limitado. Cada acesso fica registrado e você recebe um aviso. Você pode revogar a qualquer momento.
            </p>
          </div>
        </CardBody>
      </Card>
      {status ? <Alert tone={status.tone}>{status.text}</Alert> : null}
      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>Acesso ativo</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p>{active.reason}</p>
              <p className="text-xs text-fg-muted">Válido até {when(active.expiresAt)}</p>
            </div>
            <Button variant="danger" size="sm" loading={busy} onClick={() => revoke(active.id)}>
              Revogar agora
            </Button>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{active ? "Substituir autorização" : "Autorizar o suporte"}</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={create} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              Motivo
              <input
                name="reason"
                required
                minLength={5}
                maxLength={300}
                placeholder="Ex.: chamado 123, saldo da conta não confere"
                className="h-11 rounded-xl border border-line-strong bg-secondary px-3 text-sm"
              />
            </label>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1">Por quanto tempo</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="hours" value="24" defaultChecked /> 24 horas
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="hours" value="72" /> 72 horas
              </label>
            </fieldset>
            <p className="text-xs text-fg-muted">O suporte só consegue ver suas transações (data, descrição, categoria, conta e valor). Nada pode ser alterado.</p>
            <div>
              <Button type="submit" loading={busy}>
                Autorizar acesso
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      {grants.filter((g) => !g.active).length ? (
        <Card>
          <CardHeader>
            <CardTitle>Histórico</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-line text-sm">
              {grants
                .filter((g) => !g.active)
                .map((g) => (
                  <li key={g.id} className="py-2">
                    <p>{g.reason}</p>
                    <p className="text-xs text-fg-muted">
                      {when(g.grantedAt)} · {g.revokedAt ? `revogado em ${when(g.revokedAt)}` : `expirou em ${when(g.expiresAt)}`}
                    </p>
                  </li>
                ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
