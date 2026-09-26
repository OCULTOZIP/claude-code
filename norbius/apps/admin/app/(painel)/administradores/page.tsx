import { AdminToggle } from "@/components/admin-toggle";
import { adminGet, type Admin } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Card, CardBody } from "@norbius/ui";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Administradores" };

type Row = { id: string; email: string; name: string; role: string; active: boolean; lastLoginAt: string | null };
const ROLE = { support: "Suporte", billing: "Cobrança", analyst: "Analista", superadmin: "Superadmin" } as Record<string, string>;

export default async function AdminsPage() {
  const [list, me] = await Promise.all([adminGet<Row[]>("/api/admin/admins"), adminGet<Admin>("/api/admin/me")]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administradores</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Novos administradores são criados no servidor com <code className="font-mono text-xs">pnpm --filter @norbius/api admin:create</code>, que já
          cadastra o autenticador.
        </p>
      </div>
      <Card>
        <CardBody className="pt-2">
          <ul className="divide-y divide-line">
            {list.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {a.name} <span className="text-xs text-fg-muted">· {ROLE[a.role] ?? a.role}</span>
                  </p>
                  <p className="text-xs text-fg-muted">
                    {a.email} · último acesso {dateTime(a.lastLoginAt)}
                  </p>
                </div>
                {a.id === me.id ? <span className="text-xs text-fg-muted">Você</span> : <AdminToggle id={a.id} active={a.active} />}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
