import { Logo } from "@norbius/ui";
import { Settings } from "lucide-react";
import Link from "next/link";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";
import { ToastProvider } from "./toast";

export function AppShell({ name, email, children }: { name: string; email: string; children: React.ReactNode }) {
  return (
    <ToastProvider>
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden border-r border-line bg-surface lg:flex lg:flex-col">
        <div className="flex h-16 items-center px-6">
          <Link href="/dashboard" aria-label="NORBIUS — painel">
            <Logo />
          </Link>
        </div>
        <nav aria-label="Aplicativo" className="flex flex-1 flex-col gap-1 px-3 py-4">
          <NavLinks />
        </nav>
        <div className="border-t border-line p-4">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-fg-muted">{email}</p>
          <SignOutButton className="mt-3 w-full" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur-xl lg:hidden">
          <Link href="/dashboard" aria-label="NORBIUS — painel">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/configuracoes"
              aria-label="Configurações"
              className="grid size-9 place-items-center rounded-lg text-fg-secondary hover:bg-secondary hover:text-fg"
            >
              <Settings aria-hidden className="size-4" />
            </Link>
            <SignOutButton compact />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
          {children}
        </main>
        <nav
          aria-label="Aplicativo"
          className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-surface/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden"
        >
          <NavLinks compact />
        </nav>
      </div>
    </div>
    </ToastProvider>
  );
}
