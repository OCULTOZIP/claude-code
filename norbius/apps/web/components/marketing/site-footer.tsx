import { Logo } from "@norbius/ui";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-fg-muted">
            Seu dinheiro. Uma inteligência trabalhando por você.
          </p>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium text-fg">Produto</p>
          <Link href="/#recursos" className="text-fg-secondary hover:text-fg">Recursos</Link>
          <Link href="/precos" className="text-fg-secondary hover:text-fg">Preços</Link>
          <Link href="/faq" className="text-fg-secondary hover:text-fg">Perguntas frequentes</Link>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium text-fg">Legal</p>
          <Link href="/privacidade" className="text-fg-secondary hover:text-fg">Política de Privacidade</Link>
          <Link href="/termos" className="text-fg-secondary hover:text-fg">Termos de Uso</Link>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-fg-muted sm:px-6">
          © {new Date().getFullYear()} NORBIUS. O NORBIUS não é instituição financeira e não presta consultoria de
          investimentos. As informações exibidas têm caráter informativo.
        </p>
      </div>
    </footer>
  );
}
