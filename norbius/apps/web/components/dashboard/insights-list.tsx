"use client";
import { api, ClientApiError } from "@/lib/client-api";
import type { InsightView } from "@norbius/contracts";
import { cn } from "@norbius/ui";
import { AlertTriangle, Info, Lightbulb, OctagonAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Status sempre com ícone + rótulo, nunca só cor.
const SEVERITY = {
  critical: { label: "Crítico", icon: OctagonAlert, className: "text-primary-light" },
  attention: { label: "Atenção", icon: AlertTriangle, className: "text-warning" },
  opportunity: { label: "Oportunidade", icon: Lightbulb, className: "text-fg-secondary" },
  info: { label: "Informativo", icon: Info, className: "text-fg-muted" },
} as const;

export function InsightsList({ insights }: { insights: InsightView[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const visible = insights.filter((i) => !hidden.has(i.id));

  async function dismiss(id: string) {
    setHidden((s) => new Set(s).add(id));
    setError(null);
    try {
      await api(`/intelligence/insights/${id}/dismiss`, { method: "POST", json: {} });
      router.refresh();
    } catch (err) {
      setHidden((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      setError(err instanceof ClientApiError ? err.message : "Não foi possível dispensar agora.");
    }
  }

  if (!visible.length) {
    return <p className="text-sm text-fg-muted">Nenhum alerta no momento. O NORBIUS avisa aqui quando algo merecer sua atenção.</p>;
  }

  return (
    <div>
      <ul className="flex flex-col divide-y divide-line">
        {visible.map((i) => {
          const s = SEVERITY[i.severity];
          const Icon = s.icon;
          return (
            <li key={i.id} className="group flex gap-3 py-3 first:pt-0 last:pb-0">
              <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", s.className)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  <span className="sr-only">{s.label}: </span>
                  {i.title}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-fg-secondary">{i.body}</p>
                <p className={cn("mt-1 text-[11px] uppercase tracking-wide", s.className)} aria-hidden>
                  {s.label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(i.id)}
                aria-label={`Dispensar alerta: ${i.title}`}
                className="grid size-7 shrink-0 place-items-center rounded-md text-fg-muted opacity-60 hover:bg-secondary hover:text-fg group-hover:opacity-100 focus:opacity-100"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-3 text-sm text-primary-light">{error}</p> : null}
    </div>
  );
}
