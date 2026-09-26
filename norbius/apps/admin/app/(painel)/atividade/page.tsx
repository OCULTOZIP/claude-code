import { adminGet } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { buttonClasses, Card, CardBody } from "@norbius/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Atividade" };

type Entry = { id: number; actor_type: string; actor_id: string | null; subject_user_id: string | null; action: string; entity_type: string | null; metadata: Record<string, unknown>; ip: string | null; created_at: string };

const ACTOR = { user: "Usuário", admin: "Admin", system: "Sistema", ai: "Assistente" } as Record<string, string>;

export default async function AuditPage({ searchParams }: PageProps<"/atividade">) {
  const sp = await searchParams;
  const action = typeof sp.acao === "string" ? sp.acao : "";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const list = await adminGet<Entry[]>(`/api/admin/audit?${new URLSearchParams({ page: String(page), ...(action ? { action } : {}) })}`);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Atividade</h1>
        <p className="mt-1 text-sm text-fg-secondary">Registro somente-leitura. Detalhes aparecem apenas nas ações de administradores.</p>
      </div>
      <form className="flex gap-2">
        <input name="acao" defaultValue={action} placeholder="Filtrar por ação (ex.: admin., auth.login)" aria-label="Filtrar por ação" className="h-10 flex-1 rounded-xl border border-line-strong bg-secondary px-3 text-sm" />
        <button className={buttonClasses({ size: "sm", className: "h-10" })}>Filtrar</button>
      </form>
      <Card>
        <CardBody className="pt-2">
          <ul className="divide-y divide-line text-sm">
            {list.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="font-mono text-xs">{e.action}</p>
                  <p className="text-xs text-fg-muted">
                    {ACTOR[e.actor_type] ?? e.actor_type}
                    {e.subject_user_id ? (
                      <>
                        {" · cliente "}
                        <Link href={`/clientes/${e.subject_user_id}`} className="hover:underline">
                          {e.subject_user_id.slice(0, 8)}
                        </Link>
                      </>
                    ) : null}
                    {e.ip ? ` · ${e.ip}` : ""}
                    {Object.keys(e.metadata).length ? ` · ${JSON.stringify(e.metadata)}` : ""}
                  </p>
                </div>
                <span className="text-xs text-fg-muted tabular">{dateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={`/atividade?pagina=${page - 1}&acao=${encodeURIComponent(action)}`} className="text-fg-secondary hover:text-fg">← Anterior</Link> : <span />}
        {list.length === 50 ? <Link href={`/atividade?pagina=${page + 1}&acao=${encodeURIComponent(action)}`} className="text-fg-secondary hover:text-fg">Próxima →</Link> : null}
      </div>
    </div>
  );
}
