import { FlowChart } from "@/components/dashboard/flow-chart";
import { RegisterButton } from "@/components/dashboard/register-button";
import { dialogData } from "@/lib/finance-data";
import { brl, monthLabel, relativeDay, signedBrl } from "@/lib/format";
import { firstName, greeting } from "@/lib/greeting";
import { apiGet, getMe } from "@/lib/server-api";
import type { DashboardSummary } from "@norbius/contracts";
import { Badge, Card, CardBody, CardHeader, CardTitle, cn, NorbiusCore, Progress } from "@norbius/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Painel" };

function Kpi({ label, cents, hint }: { label: string; cents: number; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardBody>
        <p className={cn("text-xl font-semibold tabular sm:text-2xl")}>{brl(cents)}</p>
        {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
      </CardBody>
    </Card>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs text-fg-secondary hover:text-fg">
      {children}
    </Link>
  );
}

export default async function DashboardPage() {
  const me = await getMe();
  if (!me) redirect("/entrar");
  if (me.profile.onboardingStatus === "not_started" || me.profile.onboardingStatus === "in_progress") redirect("/onboarding");

  const s = await apiGet<DashboardSummary>("/api/v1/dashboard/summary");
  const data = await dialogData(s.today);
  const name = firstName(me.profile.displayName ?? me.user.name);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-secondary">{greeting(me.profile.timezone)},</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{name}.</h1>
        </div>
        <RegisterButton data={data} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Card className="relative overflow-hidden">
            <CardBody className="pt-6">
              <p className="text-sm text-fg-secondary">Saldo disponível</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular">{brl(s.availableBalance.cents)}</p>
              <p className="mt-2 text-xs text-fg-muted">
                {s.accounts.length
                  ? `Soma das contas do dia a dia · ${s.accounts.length} ${s.accounts.length === 1 ? "conta" : "contas"}`
                  : "Nenhuma conta cadastrada"}
              </p>
            </CardBody>
          </Card>
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <Kpi label="Receitas do mês" cents={s.monthIncome.cents} />
            <Kpi label="Despesas do mês" cents={s.monthExpense.cents} />
            <Kpi label="Investimentos" cents={s.investments.cents} />
          </div>
        </div>

        <Card className="relative order-first overflow-hidden lg:order-none">
          <div className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col items-center px-6 py-7 text-center">
            <NorbiusCore state={s.core.state} size={132} />
            <p className="mt-5 font-mono text-xs tracking-[0.3em]">{s.core.state}</p>
            <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{s.core.reason}</p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fluxo financeiro · {monthLabel(s.month)}</CardTitle>
        </CardHeader>
        <CardBody>
          <FlowChart days={s.dailyFlow} today={s.today} />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Próximos 30 dias</CardTitle>
            <SectionLink href="/contas/fixas">Contas fixas</SectionLink>
          </CardHeader>
          <CardBody>
            {s.commitments.length ? (
              <ul className="flex flex-col gap-3">
                {s.commitments.map((c) => (
                  <li key={`${c.kind}-${c.id}-${c.date}`} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{c.description}</p>
                      <p className={cn("text-xs", c.overdue ? "text-primary-light" : "text-fg-muted")}>
                        {c.overdue ? "Atrasado · " : ""}
                        {relativeDay(c.date, s.today)}
                        {c.isEstimate ? " · estimativa" : ""}
                      </p>
                    </div>
                    <span className={"shrink-0 tabular"}>
                      {c.direction === "in" ? "+ " : "− "}
                      {brl(c.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Nenhum compromisso previsto. Cadastre contas fixas para vê-las aqui.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Categorias do mês</CardTitle>
          </CardHeader>
          <CardBody>
            {s.topCategories.length ? (
              <ul className="flex flex-col gap-3.5">
                {s.topCategories.map((c) => (
                  <li key={c.categoryId} className="text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="truncate text-fg-secondary">{c.name}</span>
                      <span className="tabular">{brl(c.cents)}</span>
                    </div>
                    <Progress value={c.share} className="mt-1.5" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Sem despesas registradas neste mês.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metas</CardTitle>
            <SectionLink href="/metas">Ver todas</SectionLink>
          </CardHeader>
          <CardBody>
            {s.goals.length ? (
              <ul className="flex flex-col gap-4">
                {s.goals.map((g) => (
                  <li key={g.id} className="text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="truncate">{g.name}</span>
                      <span className="text-fg-secondary tabular">{Math.round(g.progress * 100)}%</span>
                    </div>
                    <Progress value={g.progress} tone="primary" className="mt-1.5" />
                    <p className="mt-1 text-xs text-fg-muted tabular">
                      {brl(g.currentAmountCents)} de {brl(g.targetAmountCents)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Nenhuma meta ativa.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Últimas movimentações</CardTitle>
            <SectionLink href="/transacoes">Ver todas</SectionLink>
          </CardHeader>
          <CardBody>
            {s.recent.length ? (
              <ul className="divide-y divide-line">
                {s.recent.map((r) => (
                  <li key={`${r.kind}-${r.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate">{r.description}</p>
                      <p className="text-xs text-fg-muted">
                        {r.label} · {relativeDay(r.date, s.today)}
                      </p>
                    </div>
                    <span className={"shrink-0 tabular"}>{signedBrl(r.amountCents, r.type)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">
                Nenhuma movimentação ainda. Use <span className="text-fg">Registrar</span> para lançar a primeira.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cartões</CardTitle>
            <SectionLink href="/cartoes">Ver cartões</SectionLink>
          </CardHeader>
          <CardBody>
            {s.cards.length ? (
              <ul className="flex flex-col gap-4">
                {s.cards.map((c) => {
                  const usage = c.limitCents ? c.usedLimitCents / c.limitCents : 0;
                  return (
                    <li key={c.id} className="text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="truncate">{c.name}</span>
                        {usage >= 0.8 ? <Badge tone="warning">{Math.round(usage * 100)}% do limite</Badge> : null}
                      </div>
                      <Progress value={usage} className="mt-1.5" />
                      <p className="mt-1 text-xs text-fg-muted tabular">
                        {brl(c.usedLimitCents)} usados de {brl(c.limitCents)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Nenhum cartão cadastrado.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
