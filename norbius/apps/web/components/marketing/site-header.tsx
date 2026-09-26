import { buttonClasses, Logo } from "@norbius/ui";
import Link from "next/link";

const NAV = [
  { href: "/#como-funciona", label: "Como funciona" },
  { href: "/#recursos", label: "Recursos" },
  { href: "/precos", label: "Preços" },
  { href: "/faq", label: "FAQ" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="NORBIUS — início">
          <Logo />
        </Link>
        <nav aria-label="Principal" className="hidden items-center gap-7 text-sm text-fg-secondary md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-fg">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/entrar" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            Entrar
          </Link>
          <Link href="/cadastro" className={buttonClasses({ size: "sm" })}>
            Começar agora
          </Link>
        </div>
      </div>
    </header>
  );
}
