"use client";
import { cn } from "@norbius/ui";
import { ArrowLeftRight, CreditCard, LayoutGrid, Landmark, Settings, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Painel", icon: LayoutGrid, mobile: true },
  { href: "/norbius", label: "NORBIUS", icon: Sparkles, mobile: true },
  { href: "/transacoes", label: "Transações", icon: ArrowLeftRight, mobile: true },
  { href: "/contas", label: "Contas", icon: Landmark, mobile: false },
  { href: "/cartoes", label: "Cartões", icon: CreditCard, mobile: true },
  { href: "/metas", label: "Metas", icon: Target, mobile: true },
  { href: "/configuracoes", label: "Configurações", icon: Settings, mobile: false },
];

export function NavLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  return LINKS.filter((l) => !compact || l.mobile).map(({ href, label, icon: Icon }) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-xl text-sm transition-colors",
          compact ? "min-w-0 flex-1 flex-col gap-1 px-1 py-1.5 text-[11px]" : "px-3 py-2.5",
          active ? "text-fg" : "text-fg-secondary hover:text-fg",
          active && !compact && "bg-secondary",
        )}
      >
        <Icon aria-hidden className={cn("size-[18px] shrink-0", active && "text-primary")} />
        <span className="truncate">{label}</span>
      </Link>
    );
  });
}
