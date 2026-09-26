import { AuthCard } from "@/components/auth/auth-card";
import { buttonClasses } from "@norbius/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Verificação de e-mail" };

export default async function EmailVerifiedPage({ searchParams }: PageProps<"/email-verificado">) {
  const params = await searchParams;
  if (typeof params.error === "string") {
    return (
      <AuthCard
        title="Não foi possível confirmar"
        description="O link de confirmação é inválido ou expirou. Entre com seu e-mail e senha para receber um novo link."
      >
        <Link href="/entrar" className={buttonClasses({ className: "w-full" })}>
          Ir para o login
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="E-mail confirmado" description="Sua conta está ativa. O NORBIUS está pronto para começar.">
      <Link href="/dashboard" className={buttonClasses({ className: "w-full" })}>
        Abrir meu painel
      </Link>
    </AuthCard>
  );
}
