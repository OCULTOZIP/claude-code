import { adminGet } from "@/lib/api";
import { date, dateTime } from "@/lib/format";
import { Badge, buttonClasses, Card, CardBody } from "@norbius/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Clientes" };

type Customer = { id: string; name: string; email: string; status: string; plan: "free" | "pro"; planReason: string; createdAt: string; lastSeenAt: string | null; emailVerified: boolean };

export default async function CustomersPage({ searchParams }: PageProps<"/clientes">) {
  const sp = await searchParams;
  const search = typeof sp.q === "string" ? sp.q : "";
  const plan = sp.plano === "pro" || sp.plano === "free" ? sp.plano : "";
  const status = sp.status === "suspended" ? "suspended" : "";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const qs = new URLSearchParams({ page: String(page), ...(search ? { search } : {}), ...(plan ? { plan } : {}), ...(status ? { status } : {}) });
  const { items, hasMore } = await adminGet<{ items: Customer[]; hasMore: boolean }>(`/api/admin/customers?${qs}`);
  const link = (p: number) => `/clientes?${new URLSearchParams({ pagina: String(p), ...(search ? { q: search } : {}), ...(plan ? { plano: plan } : {}), ...(status ? { status } : {}) })}`;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
      <form className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={search} placeholder="Buscar por nome ou e-mail" aria-label="Buscar por nome ou e-mail" className="h-10 min-w-56 flex-1 rounded-xl border border-line-strong bg-secondary px-3 text-sm" />
        <select name="plano" defaultValue={plan} aria-label="Plano" className="h-10 rounded-xl border border-line-strong bg-secondary px-3 text-sm">
          <option value="">Todos os planos</option>
          <option value="pro">Pro</option>
          <option value="free">Grátis</option>
        </select>
        <select name="status" defaultValue={status} aria-label="Situação" className="h-10 rounded-xl border border-line-strong bg-secondary px-3 text-sm">
          <option value="">Todas as situações</option>
          <option value="suspended">Suspensos</option>
        </select>
        <button className={buttonClasses({ size: "sm", className: "h-10" })}>Filtrar</button>
      </form>
      <Card>
        <CardBody className="pt-2">
          {items.length ? (
            <ul className="divide-y divide-line">
              {items.map((c) => (
                <li key={c.id}>
                  <Link href={`/clientes/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:opacity-80">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="truncate text-xs text-fg-muted">
                        {c.email}
                        {c.emailVerified ? "" : " · e-mail não verificado"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-fg-muted">
                      {c.status !== "active" ? <Badge tone="primary">Suspenso</Badge> : null}
                      <Badge tone={c.plan === "pro" ? "success" : "neutral"}>{c.plan === "pro" ? (c.planReason === "trial" ? "Pro (teste)" : "Pro") : "Grátis"}</Badge>
                      <span className="hidden sm:inline">desde {date(c.createdAt)} · visto {dateTime(c.lastSeenAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-fg-muted">Nenhum cliente encontrado.</p>
          )}
        </CardBody>
      </Card>
      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={link(page - 1)} className="text-fg-secondary hover:text-fg">← Anterior</Link> : <span />}
        {hasMore ? <Link href={link(page + 1)} className="text-fg-secondary hover:text-fg">Próxima →</Link> : null}
      </div>
    </div>
  );
}
