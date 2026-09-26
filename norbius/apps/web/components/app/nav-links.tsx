"use client";
import { cn } from "@norbius/ui";
import { LayoutGrid, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Só entram aqui destinos que já funcionam de verdade.
const LINKS = [
  { href: "/dashboard", label: "Painel", icon: LayoutGrid },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function NavLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  return LINKS.map(({ href, label, icon: Icon }) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-xl text-sm transition-colors",
          compact ? "flex-col gap-1 px-4 py-1.5 text-[11px]" : "px-3 py-2.5",
          active ? "text-fg" : "text-fg-secondary hover:text-fg",
          active && !compact && "bg-secondary",
        )}
      >
        <Icon aria-hidden className={cn("size-[18px]", active && "text-primary")} />
        {label}
      </Link>
    );
  });
}
