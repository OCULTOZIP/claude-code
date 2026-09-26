import { CustomerActions } from "@/components/customer-actions";
import { SupportAccess } from "@/components/support-access";
import { adminGet, can, type Admin } from "@/lib/api";
import { brl, date, dateTime } from "@/lib/format";
import { Card, CardBody, CardHeader, CardTitle } from "@norbius/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Cliente" };

type Detail = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: string;
  createdAt: string;
  lastSeenAt: string | null;
  onboarding: string | null;
  plan: "free" | "pro";
  planReason: string;
  proUntil: string | null;
  subscriptionStatus: string;
  cycle: string | null;
  trialEndsOn: string | null;
  paidThrough: string | null;
  cancelAtPeriodEnd: boolean;
  payments: { id: string; amountCents: number; status: string; dueDate: string; paidAt: string | null }[];
  grants: { id: string; reason: string; grantedAt: string; expiresAt: string; active: boolean }[];
};

const REASON = { paid: "pago", grace: "carência", trial: "teste grátis", free: "grátis" } as Record<string, string>;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

export default async function CustomerPage({ params }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  const [c, me] = await Promise.all([adminGet<Detail>(`/api/admin/customers/${id}`), adminGet<Admin>("/api/admin/me")]);
  return (
    <div className="flex flex-col gap-6">
      <Link href="/clientes" className="text-sm text-fg-secondary hover:text-fg">
        ← Clientes
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
        <p className="mt-1 text-sm text-fg-secondary">{c.email}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Conta</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="divide-y divide-line">
              <Row label="Situação" value={c.status === "active" ? "Ativa" : c.status === "suspended" ? "Suspensa" : c.status} />
              <Row label="E-mail verificado" value={c.emailVerified ? "Sim" : "Não"} />
              <Row label="Cliente desde" value={date(c.createdAt)} />
              <Row label="Último acesso" value={dateTime(c.lastSeenAt)} />
              <Row label="Onboarding" value={c.onboarding ?? "—"} />
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Plano</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="divide-y divide-line">
              <Row label="Plano" value={`${c.plan === "pro" ? "Pro" : "Grátis"} (${REASON[c.planReason] ?? c.planReason})`} />
              <Row label="Pro até" value={date(c.proUntil)} />
              <Row label="Assinatura" value={`${c.subscriptionStatus}${c.cycle ? ` · ${c.cycle === "yearly" ? "anual" : "mensal"}` : ""}${c.cancelAtPeriodEnd ? " · cancela no fim do período" : ""}`} />
              <Row label="Teste grátis até" value={date(c.trialEndsOn)} />
              <Row label="Pago até" value={date(c.paidThrough)} />
            </dl>
          </CardBody>
        </Card>
      </div>
      <CustomerActions id={c.id} suspended={c.status === "suspended"} canSupport={can(me, "audit")} canBilling={can(me, "payments")} />
      <Card>
        <CardHeader>
          <CardTitle>Pagamentos da assinatura</CardTitle>
        </CardHeader>
        <CardBody>
          {c.payments.length ? (
            <ul className="divide-y divide-line text-sm">
              {c.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {date(p.dueDate)} · {p.status}
                  </span>
                  <span className="tabular">{brl(p.amountCents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">Nenhum pagamento.</p>
          )}
        </CardBody>
      </Card>
      {can(me, "audit") ? <SupportAccess grants={c.grants} /> : null}
    </div>
  );
}
