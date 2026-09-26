import { buttonClasses, Logo } from "@norbius/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="flex max-w-sm flex-col items-center text-center">
        <Logo />
        <p className="mt-10 font-mono text-sm text-primary-light">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Página não encontrada</h1>
        <p className="mt-2 text-sm text-fg-secondary">O endereço acessado não existe ou foi movido.</p>
        <Link href="/" className={buttonClasses({ variant: "secondary", className: "mt-8" })}>
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
