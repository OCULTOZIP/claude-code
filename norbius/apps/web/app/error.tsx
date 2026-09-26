"use client";
import { Button, Logo } from "@norbius/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-sm flex-col items-center text-center">
        <Logo />
        <h1 className="mt-10 text-2xl font-semibold">Algo não saiu como esperado</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          Tivemos um problema ao carregar esta página. Seus dados não foram alterados.
        </p>
        <Button variant="secondary" className="mt-8" onClick={reset}>
          Tentar novamente
        </Button>
      </div>
    </main>
  );
}
