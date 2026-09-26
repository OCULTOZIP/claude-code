"use client";
import { authClient } from "@/lib/auth-client";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Spinner } from "@norbius/ui";
import { Monitor, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type SessionItem = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; updatedAt: Date; createdAt: Date };

function describeAgent(ua?: string | null) {
  if (!ua) return { label: "Dispositivo desconhecido", mobile: false };
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) && !mobile ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return { label: os ? `${browser} · ${os}` : browser, mobile };
}

export function SessionsList() {
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [currentToken, setCurrentToken] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const [list, current] = await Promise.all([authClient.listSessions(), authClient.getSession()]);
    if (list.error) return setError("Não foi possível carregar as sessões.");
    setCurrentToken(current.data?.session.token);
    setSessions(
      [...(list.data as SessionItem[])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const others = sessions?.filter((s) => s.token !== currentToken) ?? [];

  return (
    <Card>
      <CardHeader>
        <div>
          <h2 className="font-semibold">Sessões ativas</h2>
          <p className="mt-1 text-sm text-fg-secondary">Dispositivos conectados à sua conta.</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {!sessions && !error ? <Spinner className="text-fg-muted" /> : null}
        {sessions ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {sessions.map((s) => {
              const agent = describeAgent(s.userAgent);
              const Icon = agent.mobile ? Smartphone : Monitor;
              const isCurrent = s.token === currentToken;
              return (
                <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon aria-hidden className="size-5 shrink-0 text-fg-muted" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm">
                        {agent.label}
                        {isCurrent ? <Badge tone="success">Este dispositivo</Badge> : null}
                      </p>
                      <p className="text-xs text-fg-muted">
                        Último uso {new Date(s.updatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        {s.ipAddress ? ` · IP ${s.ipAddress}` : ""}
                      </p>
                    </div>
                  </div>
                  {!isCurrent ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === s.id}
                      onClick={async () => {
                        setBusy(s.id);
                        await authClient.revokeSession({ token: s.token });
                        setBusy(null);
                        await load();
                      }}
                    >
                      Encerrar
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {others.length > 0 ? (
          <div>
            <Button
              variant="danger"
              size="sm"
              loading={busy === "others"}
              onClick={async () => {
                setBusy("others");
                await authClient.revokeOtherSessions();
                setBusy(null);
                await load();
              }}
            >
              Encerrar todas as outras sessões
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
