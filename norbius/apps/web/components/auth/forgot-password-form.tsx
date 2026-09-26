"use client";
import { AuthCard } from "@/components/auth/auth-card";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { validate, type FieldErrors } from "@/lib/form";
import { forgotPasswordSchema } from "@norbius/contracts";
import { Alert, Button, Field } from "@norbius/ui";
import Link from "next/link";
import { useState } from "react";

export function ForgotPasswordForm() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(undefined);
    const parsed = validate(forgotPasswordSchema, { email: new FormData(e.currentTarget).get("email") });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    setLoading(true);
    const { error } = await authClient.requestPasswordReset({ email: parsed.data.email, redirectTo: "/redefinir-senha" });
    setLoading(false);
    if (error) return setFormError(authErrorMessage(error));
    setSent(true);
  }

  return (
    <AuthCard
      title="Recuperar senha"
      description="Informe seu e-mail. Se houver uma conta, enviaremos um link para criar uma nova senha."
      footer={
        <Link href="/entrar" className="font-medium text-fg hover:text-primary-light">
          Voltar ao login
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success">
          Se existir uma conta com esse e-mail, o link chegará em instantes. Ele expira em 30 minutos.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <Field label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" error={errors.email} />
          <Button type="submit" loading={loading} className="w-full">
            Enviar link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
