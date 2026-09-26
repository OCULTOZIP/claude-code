"use client";
import { AuthCard } from "@/components/auth/auth-card";
import { OrDivider } from "@/components/auth/divider";
import { GoogleButton } from "@/components/auth/google-button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { validate, type FieldErrors } from "@/lib/form";
import { PASSWORD_MIN_LENGTH, signUpSchema } from "@norbius/contracts";
import { Alert, Button, Field } from "@norbius/ui";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const hydrated = useHydrated();
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(undefined);
    const form = new FormData(e.currentTarget);
    const parsed = validate(signUpSchema, {
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      acceptTerms: form.get("acceptTerms") === "on",
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    setLoading(true);
    const { name, email, password, acceptTerms } = parsed.data;
    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
      // Validado também no servidor.
      acceptTerms,
    } as Parameters<typeof authClient.signUp.email>[0]);
    setLoading(false);
    if (error) return setFormError(authErrorMessage(error));
    setSentTo(email);
  }

  if (sentTo) return <CheckInbox email={sentTo} />;

  return (
    <AuthCard
      title="Criar conta"
      description="Em poucos passos o NORBIUS começa a trabalhar por você."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/entrar" className="font-medium text-fg hover:text-primary-light">
            Entrar
          </Link>
        </>
      }
    >
      {formError ? <Alert tone="error" className="mb-5">{formError}</Alert> : null}
      {googleEnabled ? (
        <>
          <GoogleButton next="/dashboard" onError={setFormError} />
          <p className="mt-3 text-center text-xs text-fg-muted">
            Ao continuar com Google, você concorda com os <Link href="/termos" className="underline">Termos</Link> e a{" "}
            <Link href="/privacidade" className="underline">Política de Privacidade</Link>.
          </p>
          <OrDivider />
        </>
      ) : null}
      <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Nome" name="name" autoComplete="name" error={errors.name} />
        <Field label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" error={errors.email} />
        <Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="new-password"
          error={errors.password}
          hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres. Prefira uma frase longa.`}
        />
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-3 text-sm text-fg-secondary">
            <input
              type="checkbox"
              name="acceptTerms"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              aria-invalid={errors.acceptTerms ? true : undefined}
            />
            <span>
              Li e aceito os{" "}
              <Link href="/termos" target="_blank" className="text-fg underline underline-offset-4">
                Termos de Uso
              </Link>{" "}
              e a{" "}
              <Link href="/privacidade" target="_blank" className="text-fg underline underline-offset-4">
                Política de Privacidade
              </Link>
              .
            </span>
          </label>
          {errors.acceptTerms ? <p className="text-xs text-primary-light">{errors.acceptTerms}</p> : null}
        </div>
        <Button type="submit" disabled={!hydrated} loading={loading} className="mt-1 w-full">
          Criar conta
        </Button>
      </form>
    </AuthCard>
  );
}

function CheckInbox({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  return (
    <AuthCard
      title="Confirme seu e-mail"
      description={
        <>
          Se <span className="text-fg">{email}</span> puder ser usado para um novo cadastro, você receberá um link de
          confirmação em instantes. O link expira em 24 horas.
        </>
      }
      footer={
        <Link href="/entrar" className="font-medium text-fg hover:text-primary-light">
          Ir para o login
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="grid size-14 place-items-center rounded-2xl border border-line-strong bg-surface">
          <MailCheck aria-hidden className="size-6 text-primary" />
        </span>
        <p className="text-sm text-fg-secondary">Não recebeu? Verifique o spam ou envie novamente.</p>
        {state === "sent" ? <Alert tone="success">Se houver uma conta pendente, um novo link foi enviado.</Alert> : null}
        {state === "error" ? <Alert tone="error">Não foi possível reenviar agora. Tente em alguns minutos.</Alert> : null}
        <Button
          variant="secondary"
          loading={state === "sending"}
          onClick={async () => {
            setState("sending");
            const { error } = await authClient.sendVerificationEmail({ email });
            setState(error ? "error" : "sent");
          }}
        >
          Reenviar e-mail
        </Button>
      </div>
    </AuthCard>
  );
}
