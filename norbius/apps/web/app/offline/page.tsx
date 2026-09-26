import { RetryButton } from "@/components/app/retry-button";
import { Logo } from "@norbius/ui";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sem conexão" };

// Página guardada pelo service worker para quando não houver internet.
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="flex max-w-sm flex-col items-center">
        <Logo />
        <h1 className="mt-10 text-xl font-semibold">Sem conexão com a internet</h1>
        <p className="mt-3 text-sm leading-relaxed text-fg-secondary">
          O NORBIUS precisa de internet para mostrar seus dados. Nada foi perdido: assim que a conexão voltar, é só tentar de novo.
        </p>
        <RetryButton />
      </div>
    </main>
  );
}
