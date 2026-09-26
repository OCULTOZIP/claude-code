"use client";
import { api, ClientApiError } from "@/lib/client-api";
import { Button, cn } from "@norbius/ui";
import { Check, Clock, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type Card = {
  kind: "created" | "pending" | "updated";
  title: string;
  lines: string[];
  undo?: { method: "DELETE" | "POST"; path: string };
  actionId?: string;
  status?: string;
};

/** Cartão de ação no chat: registro feito (com desfazer) ou pendente (confirmar/cancelar). */
export function ActionCard({ card: initial }: { card: Card }) {
  const router = useRouter();
  const [card, setCard] = useState(initial);
  const [state, setState] = useState<"idle" | "busy" | "undone" | "confirmed" | "rejected" | "error">(
    initial.status === "executed" ? "confirmed" : initial.status === "rejected" ? "rejected" : initial.status === "expired" ? "error" : "idle",
  );
  const [error, setError] = useState<string>(initial.status === "expired" ? "Esta ação expirou." : "");

  async function run(fn: () => Promise<void>) {
    setState("busy");
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setState("error");
      setError(err instanceof ClientApiError ? err.message : "Não foi possível concluir.");
    }
  }

  // Só caminhos da própria API (gerados pelo servidor) podem ser chamados.
  const undo = card.undo && card.undo.path.startsWith("/api/v1/") ? card.undo : undefined;
  const pending = card.kind === "pending" && (state === "idle" || state === "busy");

  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface p-4 text-sm",
        pending ? "border-primary-dark/80" : "border-line-strong",
        state === "undone" || state === "rejected" ? "opacity-60" : "",
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        {pending ? <Clock aria-hidden className="size-4 text-primary" /> : <Check aria-hidden className="size-4 text-fg-secondary" />}
        {state === "undone" ? "Desfeito" : state === "rejected" ? "Cancelado" : card.title}
      </p>
      <ul className="mt-1.5 flex flex-col gap-0.5 text-fg-secondary">
        {card.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-xs text-primary-light">{error}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {pending ? (
          <>
            <Button
              size="sm"
              loading={state === "busy"}
              onClick={() =>
                run(async () => {
                  const res = await api<{ card: Card | null }>(`/ai/actions/${card.actionId}/confirm`, { method: "POST", json: {} });
                  if (res.card) setCard({ ...res.card });
                  setState("confirmed");
                })
              }
            >
              Confirmar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={state === "busy"}
              onClick={() =>
                run(async () => {
                  await api(`/ai/actions/${card.actionId}/reject`, { method: "POST", json: {} });
                  setState("rejected");
                })
              }
            >
              <X aria-hidden className="size-4" /> Cancelar
            </Button>
          </>
        ) : null}
        {undo && (state === "idle" || state === "confirmed") ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              run(async () => {
                const res = await fetch(undo.path, {
                  method: undo.method,
                  headers: undo.method === "POST" ? { "content-type": "application/json" } : {},
                  body: undo.method === "POST" ? "{}" : undefined,
                  credentials: "same-origin",
                });
                if (!res.ok) throw new Error("undo failed");
                setState("undone");
              })
            }
          >
            <Undo2 aria-hidden className="size-4" /> Desfazer
          </Button>
        ) : null}
      </div>
    </div>
  );
}
