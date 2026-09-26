"use client";
import { cn } from "@norbius/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/configuracoes", label: "Perfil" },
  { href: "/configuracoes/seguranca", label: "Segurança" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Configurações" className="flex gap-1 border-b border-line">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors",
              active ? "border-primary text-fg" : "border-transparent text-fg-secondary hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
