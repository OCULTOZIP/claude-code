"use client";
import { AuthCard } from "@/components/auth/auth-card";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { validate, type FieldErrors } from "@/lib/form";
import { PASSWORD_MIN_LENGTH, resetPasswordSchema } from "@norbius/contracts";
import { Alert, Button, buttonClasses, Field } from "@norbius/ui";
import Link from "next/link";
import { useState } from "react";

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <AuthCard title="Link inválido" description="Este link de redefinição é inválido ou expirou.">
        <Link href="/recuperar-senha" className={buttonClasses({ className: "w-full" })}>
          Solicitar novo link
        </Link>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard
        title="Senha redefinida"
        description="Por segurança, encerramos todas as sessões abertas. Entre novamente com a nova senha."
      >
        <Link href="/entrar" className={buttonClasses({ className: "w-full" })}>
          Entrar
        </Link>
      </AuthCard>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(undefined);
    const form = new FormData(e.currentTarget);
    const parsed = validate(resetPasswordSchema, {
      password: form.get("password"),
      confirmPassword: form.get("confirmPassword"),
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    setLoading(true);
    const { error } = await authClient.resetPassword({ newPassword: parsed.data.password, token: token! });
    setLoading(false);
    if (error) return setFormError(authErrorMessage(error));
    setDone(true);
  }

  return (
    <AuthCard title="Crie uma nova senha" description="Escolha uma senha que você não usa em outros serviços.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <Alert tone="error">{formError}</Alert> : null}
        <Field
          label="Nova senha"
          name="password"
          type="password"
          autoComplete="new-password"
          error={errors.password}
          hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
        />
        <Field
          label="Confirme a nova senha"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword}
        />
        <Button type="submit" loading={loading} className="w-full">
          Salvar nova senha
        </Button>
      </form>
    </AuthCard>
  );
}
