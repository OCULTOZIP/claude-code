import { firstName, greeting } from "@/lib/greeting";
import { getMe } from "@/lib/server-api";
import { Card, CardBody, CardHeader, CardTitle, NorbiusCore } from "@norbius/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Painel" };

const METRICS = ["Saldo disponível", "Receitas do mês", "Despesas do mês", "Investimentos"];

export default async function DashboardPage() {
  const me = await getMe();
  if (!me) redirect("/entrar");
  const name = firstName(me.profile.displayName ?? me.user.name);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-fg-secondary">{greeting(me.profile.timezone)},</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{name}.</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="grid grid-cols-2 gap-4 self-start">
          {METRICS.map((label) => (
            <Card key={label}>
              <CardHeader>
                <CardTitle>{label}</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-2xl font-semibold text-fg-muted tabular" aria-label="Sem dados">
                  —
                </p>
                <p className="mt-1 text-xs text-fg-muted">Sem registros</p>
              </CardBody>
            </Card>
          ))}
        </div>

        <Card className="relative order-first overflow-hidden lg:order-none">
          <div className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col items-center px-6 py-8 text-center">
            <NorbiusCore state="ACTIVE" size={150} />
            <p className="mt-6 font-mono text-xs tracking-[0.3em] text-fg">ACTIVE</p>
            <p className="mt-2 text-sm leading-relaxed text-fg-secondary">
              Sistema ativo. Ainda não há dados financeiros para analisar — nenhuma análise é exibida sem dados reais.
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-2 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Seu centro de comando está pronto</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-fg-secondary">
              Contas, transações, cartões e metas serão liberados nas próximas atualizações. Assim que você registrar
              suas primeiras movimentações, este painel passa a mostrar seus números reais.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
