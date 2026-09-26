"use client";
import { AuthCard } from "@/components/auth/auth-card";
import { OrDivider } from "@/components/auth/divider";
import { GoogleButton } from "@/components/auth/google-button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { validate, type FieldErrors } from "@/lib/form";
import { Alert, Button, Field } from "@norbius/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";

export function SignInForm({
  next,
  googleEnabled,
  initialError,
}: {
  next: string;
  googleEnabled: boolean;
  initialError?: string | undefined;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState(initialError);
  const [notice, setNotice] = useState<string>();
  const hydrated = useHydrated();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(undefined);
    setNotice(undefined);
    const form = new FormData(e.currentTarget);
    // Zod só carrega no envio: deixa a página leve (Lighthouse).
    const { signInSchema } = await import("@norbius/contracts");
    const parsed = validate(signInSchema, { email: form.get("email"), password: form.get("password") });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    setLoading(true);
    const { error } = await authClient.signIn.email(parsed.data);
    setLoading(false);
    if (error) {
      // 403 = e-mail não verificado: o servidor já reenviou o link.
      if (error.status === 403) setNotice(authErrorMessage(error));
      else setFormError(authErrorMessage(error));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <AuthCard
      title="Entrar"
      description="Bem-vindo de volta ao NORBIUS."
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="font-medium text-fg hover:text-primary-light">
            Criar conta
          </Link>
        </>
      }
    >
      {formError ? <Alert tone="error" className="mb-5">{formError}</Alert> : null}
      {notice ? <Alert tone="warning" className="mb-5">{notice}</Alert> : null}
      {googleEnabled ? (
        <>
          <GoogleButton next={next} onError={setFormError} />
          <OrDivider />
        </>
      ) : null}
      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" error={errors.email} />
        <Field label="Senha" name="password" type="password" autoComplete="current-password" error={errors.password} />
        <div className="-mt-1 flex justify-end">
          <Link href="/recuperar-senha" className="text-xs text-fg-secondary hover:text-fg">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" disabled={!hydrated} loading={loading} className="w-full">
          Entrar
        </Button>
      </form>
    </AuthCard>
  );
}
