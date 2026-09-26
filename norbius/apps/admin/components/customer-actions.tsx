"use client";
import { adminPost } from "@/lib/client";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@norbius/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Ações sensíveis: exigem motivo, ficam registradas e são conferidas no servidor e no banco. */
export function CustomerActions({ id, suspended, canSupport, canBilling }: { id: string; suspended: boolean; canSupport: boolean; canBilling: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!canSupport && !canBilling) return null;

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ tone: "success", text: await fn() });
      router.refresh();
    } catch (err) {
      setStatus({ tone: "error", text: err instanceof Error ? err.message : "Falhou." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ações</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
        {status ? <Alert tone={status.tone}>{status.text}</Alert> : null}
        {canSupport ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
              void run(async () => {
                await adminPost(`/api/admin/customers/${id}/status`, { status: suspended ? "active" : "suspended", reason });
                return suspended ? "Conta reativada." : "Conta suspensa e sessões encerradas.";
              });
            }}
          >
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-fg-muted">
              Motivo ({suspended ? "reativar" : "suspender"})
              <input name="reason" required minLength={5} maxLength={300} className="h-10 rounded-xl border border-line-strong bg-secondary px-3 text-sm text-fg" />
            </label>
            <Button type="submit" variant={suspended ? "secondary" : "danger"} loading={busy}>
              {suspended ? "Reativar conta" : "Suspender conta"}
            </Button>
          </form>
        ) : null}
        {canBilling ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const r = await adminPost<{ trialEndsOn: string }>(`/api/admin/customers/${id}/trial`, { days: Number(f.get("days")), reason: String(f.get("reason") ?? "") });
                return `Teste grátis liberado até ${r.trialEndsOn.split("-").reverse().join("/")}.`;
              });
            }}
          >
            <label className="flex w-24 flex-col gap-1 text-xs text-fg-muted">
              Dias
              <input name="days" type="number" min={1} max={90} defaultValue={7} required className="h-10 rounded-xl border border-line-strong bg-secondary px-3 text-sm text-fg" />
            </label>
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-fg-muted">
              Motivo
              <input name="reason" required minLength={5} maxLength={300} className="h-10 rounded-xl border border-line-strong bg-secondary px-3 text-sm text-fg" />
            </label>
            <Button type="submit" variant="secondary" loading={busy}>
              Liberar teste grátis
            </Button>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
