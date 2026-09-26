"use client";
import { api } from "@/lib/client-api";
import { useHydrated } from "@/lib/use-hydrated";
import { NOTIFICATION_TYPE_INFO, type NotificationPreference } from "@norbius/contracts";
import { Alert, Button, Card, CardBody } from "@norbius/ui";
import { useState } from "react";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-end gap-2 text-xs text-fg-secondary">
      <span className="sm:sr-only">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/60 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
      />
    </label>
  );
}

export function NotificationPreferencesForm({ initial }: { initial: NotificationPreference[] }) {
  const [prefs, setPrefs] = useState(initial);
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string }>();
  const [loading, setLoading] = useState(false);
  const hydrated = useHydrated();

  function set(type: NotificationPreference["type"], patch: Partial<NotificationPreference>) {
    setStatus(undefined);
    setPrefs((list) => list.map((p) => (p.type === type ? { ...p, ...patch } : p)));
  }

  async function save() {
    setLoading(true);
    setStatus(undefined);
    try {
      setPrefs(await api<NotificationPreference[]>("/notifications/preferences", { method: "PUT", json: { preferences: prefs } }));
      setStatus({ tone: "success", text: "Preferências salvas." });
    } catch {
      setStatus({ tone: "error", text: "Não foi possível salvar. Tente novamente." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody className="pt-6">
        <div className="flex flex-col gap-5">
          {status ? <Alert tone={status.tone}>{status.text}</Alert> : null}
          <p className="text-sm text-fg-secondary">
            Escolha como o NORBIUS avisa sobre cada tipo de alerta. E-mails não saem entre 22h e 8h: ficam para as 8h. A análise
            automática roda todo dia às 6h.
          </p>
          <div>
            <div className="hidden grid-cols-[1fr_4.5rem_4.5rem] gap-3 border-b border-line pb-2 text-xs text-fg-muted sm:grid">
              <span>Tipo de aviso</span>
              <span className="text-right">No app</span>
              <span className="text-right">E-mail</span>
            </div>
            <ul className="divide-y divide-line">
              {prefs.map((p) => {
                const info = NOTIFICATION_TYPE_INFO[p.type];
                return (
                  <li key={p.type} className="grid grid-cols-1 gap-3 py-3.5 sm:grid-cols-[1fr_4.5rem_4.5rem] sm:items-center">
                    <div>
                      <p className="text-sm font-medium">{info.label}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">{info.description}</p>
                    </div>
                    <div className="flex gap-6 sm:contents">
                      <Toggle label="No app" checked={p.inApp} onChange={(v) => set(p.type, { inApp: v })} />
                      <Toggle label="E-mail" checked={p.email} onChange={(v) => set(p.type, { email: v })} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <Button type="button" onClick={save} disabled={!hydrated} loading={loading}>
              Salvar
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
