"use client";
import { api } from "@/lib/client-api";
import type { NotificationsList, NotificationView } from "@norbius/contracts";
import { cn } from "@norbius/ui";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 60_000;

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

const DOT: Record<NonNullable<NotificationView["severity"]>, string> = {
  critical: "bg-primary",
  attention: "bg-warning",
  opportunity: "bg-fg-secondary",
  info: "bg-fg-muted",
};

/** Sino com avisos do app (derivados dos alertas). Atualiza a cada minuto e ao abrir. */
export function NotificationBell({ align = "left" }: { align?: "left" | "right" }) {
  const [data, setData] = useState<NotificationsList | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<NotificationsList>("/notifications"));
    } catch {
      // sem rede ou sessão expirando: mantém o que já estava
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function read(id: string) {
    setData((d) => d && { unread: Math.max(0, d.unread - 1), items: d.items.map((i) => (i.id === id ? { ...i, read: true } : i)) });
    await api(`/notifications/${id}/read`, { method: "POST", json: {} }).catch(() => load());
  }

  async function readAll() {
    setData((d) => d && { unread: 0, items: d.items.map((i) => ({ ...i, read: true })) });
    await api("/notifications/read-all", { method: "POST", json: {} }).catch(() => load());
  }

  const unread = data?.unread ?? 0;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={unread ? `Avisos: ${unread} não ${unread === 1 ? "lido" : "lidos"}` : "Avisos"}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        className="relative grid size-9 place-items-center rounded-lg text-fg-secondary hover:bg-secondary hover:text-fg"
      >
        <Bell aria-hidden className="size-4" />
        {unread ? (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-white tabular">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Avisos"
          className={cn(
            "absolute top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl",
            align === "left" ? "left-0" : "right-0",
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Avisos</p>
            {unread ? (
              <button type="button" onClick={readAll} className="text-xs text-fg-secondary hover:text-fg">
                Marcar todos como lidos
              </button>
            ) : null}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {data?.items.length ? (
              data.items.map((i) => (
                <li key={i.id} className="border-b border-line last:border-0">
                  <Link
                    href="/dashboard"
                    onClick={() => {
                      if (!i.read) void read(i.id);
                      setOpen(false);
                    }}
                    className={cn("flex gap-3 px-4 py-3 hover:bg-secondary", i.read && "opacity-60")}
                  >
                    <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", i.severity ? DOT[i.severity] : "bg-fg-muted")} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {!i.read ? <span className="sr-only">Não lido: </span> : null}
                        {i.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-fg-secondary">{i.body}</span>
                      <span className="mt-1 block text-[11px] text-fg-muted">{ago(i.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))
            ) : (
              <li className="px-4 py-8 text-center text-sm text-fg-muted">Nenhum aviso por enquanto.</li>
            )}
          </ul>
          <Link
            href="/configuracoes/notificacoes"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-2.5 text-center text-xs text-fg-secondary hover:text-fg"
          >
            Preferências de aviso
          </Link>
        </div>
      ) : null}
    </div>
  );
}
