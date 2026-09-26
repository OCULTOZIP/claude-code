import { monthLabel } from "@/lib/format";
import { apiGet } from "@/lib/server-api";
import { buttonClasses, Card, CardBody, CardHeader, CardTitle } from "@norbius/ui";
import { Download, FileText, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Relatórios" };

export default async function ReportsPage() {
  const { months, pro } = await apiGet<{ months: string[]; pro: boolean }>("/api/v1/reports/months");
  const current = months[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Resumo mensal em PDF: receitas, despesas, categorias, maiores gastos, saldos, faturas, metas e alertas do mês.
        </p>
      </div>

      {!pro ? (
        <Card>
          <CardBody className="flex flex-col items-start gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
              <div>
                <p className="text-sm font-medium">Relatórios completos fazem parte do Pro</p>
                <p className="mt-1 text-sm text-fg-secondary">No plano grátis você exporta suas transações em CSV, em Transações.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href="/transacoes" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                Exportar CSV
              </Link>
              <Link href="/configuracoes/plano" className={buttonClasses({ size: "sm" })}>
                Conhecer o Pro
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Relatórios mensais</CardTitle>
        </CardHeader>
        <CardBody>
          {months.length ? (
            <ul className="divide-y divide-line">
              {months.map((m) => (
                <li key={m} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText aria-hidden className="size-4 shrink-0 text-fg-muted" />
                    <div>
                      <p className="text-sm font-medium capitalize">{monthLabel(m)}</p>
                      <p className="text-xs text-fg-muted">{m === current ? "Mês em andamento: valores até hoje" : "Mês fechado"}</p>
                    </div>
                  </div>
                  {pro ? (
                    <a
                      href={`/api/v1/reports/monthly?month=${m}`}
                      download={`norbius-${m}.pdf`}
                      className={buttonClasses({ variant: "secondary", size: "sm" })}
                      aria-label={`Baixar relatório de ${monthLabel(m)} em PDF`}
                    >
                      <Download aria-hidden className="size-4" /> PDF
                    </a>
                  ) : (
                    <span className="text-xs text-fg-muted">Pro</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">Ainda não há movimentações. Os relatórios aparecem aqui a partir do primeiro registro.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
