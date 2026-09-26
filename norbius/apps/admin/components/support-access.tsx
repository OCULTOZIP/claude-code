"use client";
import { adminFetch } from "@/lib/client";
import { brl, date, dateTime } from "@/lib/format";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@norbius/ui";
import { useState } from "react";

type Grant = { id: string; reason: string; grantedAt: string; expiresAt: string; active: boolean };
type Tx = { date: string; description: string; type: string; amountCents: number; category: string | null; account: string | null };

/** Acesso excepcional: só existe se o cliente autorizou; cada abertura é registrada e o cliente é avisado. */
export function SupportAccess({ grants }: { grants: Grant[] }) {
  const [rows, setRows] = useState<Record<string, Tx[]>>({});
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Acesso autorizado pelo cliente</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <p className="text-sm text-fg-secondary">
          O painel não enxerga dados financeiros. Só é possível ver as transações se o próprio cliente autorizar, por tempo limitado, em
          Configurações → Suporte. Cada abertura fica registrada e o cliente recebe um aviso.
        </p>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {grants.length ? (
          <ul className="flex flex-col gap-3">
            {grants.map((g) => (
              <li key={g.id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{g.reason}</p>
                    <p className="text-xs text-fg-muted">
                      Autorizado em {dateTime(g.grantedAt)} · {g.active ? `válido até ${dateTime(g.expiresAt)}` : "expirado ou revogado"}
                    </p>
                  </div>
                  {g.active ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        setError(null);
                        try {
                          const list = await adminFetch<Tx[]>(`/api/admin/grants/${g.id}/transactions`);
                          setRows((r) => ({ ...r, [g.id]: list }));
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Falhou.");
                        }
                      }}
                    >
                      Ver transações
                    </Button>
                  ) : null}
                </div>
                {rows[g.id] ? (
                  <table className="mt-3 w-full text-xs">
                    <thead className="text-fg-muted">
                      <tr>
                        <th className="py-1 text-left font-medium">Data</th>
                        <th className="py-1 text-left font-medium">Descrição</th>
                        <th className="py-1 text-left font-medium">Categoria</th>
                        <th className="py-1 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line tabular">
                      {rows[g.id]!.map((t, i) => (
                        <tr key={i}>
                          <td className="py-1">{date(t.date)}</td>
                          <td className="py-1">{t.description}</td>
                          <td className="py-1">{t.category ?? "—"}</td>
                          <td className="py-1 text-right">{`${t.type === "income" ? "+" : t.type === "expense" ? "−" : ""} ${brl(t.amountCents)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">Nenhuma autorização concedida por este cliente.</p>
        )}
      </CardBody>
    </Card>
  );
}
