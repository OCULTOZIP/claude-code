import { LogoutButton } from "@/components/logout-button";
import { adminGet, can, type Admin } from "@/lib/api";
import { Logo } from "@norbius/ui";
import { Activity, BarChart3, CreditCard, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";

const ROLE_LABEL = { support: "Suporte", billing: "Cobrança", analyst: "Analista", superadmin: "Superadmin" } as const;

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await adminGet<Admin>("/api/admin/me");
  const links = [
    { href: "/", label: "Métricas", icon: BarChart3, show: can(me, "metrics") },
    { href: "/clientes", label: "Clientes", icon: Users, show: can(me, "customers") },
    { href: "/pagamentos", label: "Pagamentos", icon: CreditCard, show: can(me, "payments") },
    { href: "/atividade", label: "Atividade", icon: Activity, show: can(me, "audit") },
    { href: "/administradores", label: "Administradores", icon: ShieldCheck, show: can(me, "admins") },
  ].filter((l) => l.show);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-line bg-surface lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center justify-between px-5">
          <Logo />
          <span className="rounded-md border border-primary/60 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-primary-light">ADMIN</span>
        </div>
        <nav aria-label="Painel" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:py-4">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-fg-secondary hover:bg-secondary hover:text-fg">
              <Icon aria-hidden className="size-4" /> {label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-line p-4 lg:block">
          <p className="truncate text-sm font-medium">{me.name}</p>
          <p className="truncate text-xs text-fg-muted">
            {me.email} · {ROLE_LABEL[me.role]}
          </p>
          <LogoutButton />
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
