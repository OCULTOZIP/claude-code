import { adminGet } from "@/lib/api";
import { brl, int, pct } from "@/lib/format";
import { Card, CardBody, CardHeader, CardTitle } from "@norbius/ui";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Métricas" };

type Metrics = {
  users: { total: number; verified: number; new7d: number; new30d: number; suspended: number };
  active: { d1: number; d7: number; d30: number };
  subscriptions: { paying: number; trialing: number; trialsStarted: number; trialsConverted: number; conversion: number | null; canceled30d: number; mrrCents: number };
  ai: { messagesMonth: number; tokensMonth: number };
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardBody className="pt-5">
        <p className="text-xs text-fg-muted">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
        {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
      </CardBody>
    </Card>
  );
}

export default async function MetricsPage() {
  const m = await adminGet<Metrics>("/api/admin/metrics");
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Métricas</h1>
        <p className="mt-1 text-sm text-fg-secondary">Números agregados. O painel não tem acesso a dados financeiros dos clientes.</p>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-fg-secondary">Receita</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="MRR" value={brl(m.subscriptions.mrrCents)} hint="Anual conta 1/12 por mês" />
          <Stat label="Assinantes pagantes" value={int(m.subscriptions.paying)} />
          <Stat label="Em teste grátis" value={int(m.subscriptions.trialing)} />
          <Stat label="Conversão teste → pago" value={pct(m.subscriptions.conversion)} hint={`${int(m.subscriptions.trialsConverted)} de ${int(m.subscriptions.trialsStarted)} testes`} />
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-fg-secondary">Usuários</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total" value={int(m.users.total)} hint={`${int(m.users.verified)} com e-mail verificado`} />
          <Stat label="Novos (7 / 30 dias)" value={`${int(m.users.new7d)} / ${int(m.users.new30d)}`} />
          <Stat label="Ativos (dia / semana / mês)" value={`${int(m.active.d1)} / ${int(m.active.d7)} / ${int(m.active.d30)}`} />
          <Stat label="Cancelamentos (30 dias)" value={int(m.subscriptions.canceled30d)} hint={`${int(m.users.suspended)} contas suspensas`} />
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-fg-secondary">Assistente</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Mensagens no mês" value={int(m.ai.messagesMonth)} />
          <Stat label="Tokens no mês" value={int(m.ai.tokensMonth)} hint="Entrada + saída, todos os usuários" />
        </div>
      </section>
    </div>
  );
}
