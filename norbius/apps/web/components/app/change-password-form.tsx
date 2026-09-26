"use client";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { validate, type FieldErrors } from "@/lib/form";
import { changePasswordSchema, PASSWORD_MIN_LENGTH } from "@norbius/contracts";
import { Alert, Button, Card, CardBody, CardHeader, Field } from "@norbius/ui";
import { useEffect, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";

export function ChangePasswordForm() {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string }>();
  const hydrated = useHydrated();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    authClient.listAccounts().then(({ data }) => {
      setHasPassword(Boolean(data?.some((a) => a.providerId === "credential")));
    });
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus(undefined);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const parsed = validate(changePasswordSchema, {
      currentPassword: form.get("currentPassword"),
      newPassword: form.get("newPassword"),
      confirmPassword: form.get("confirmPassword"),
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    setLoading(true);
    const { error } = await authClient.changePassword({
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      revokeOtherSessions: true,
    });
    setLoading(false);
    if (error) return setStatus({ tone: "error", text: authErrorMessage(error) });
    formEl.reset();
    setStatus({ tone: "success", text: "Senha alterada. As outras sessões foram encerradas." });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <h2 className="font-semibold">Senha</h2>
          <p className="mt-1 text-sm text-fg-secondary">Ao alterar a senha, as sessões em outros dispositivos são encerradas.</p>
        </div>
      </CardHeader>
      <CardBody>
        {hasPassword === false ? (
          <Alert>
            Sua conta usa o login com Google. Para definir uma senha, use “Esqueci minha senha” na tela de login.
          </Alert>
        ) : (
          <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            {status ? <Alert tone={status.tone}>{status.text}</Alert> : null}
            <Field label="Senha atual" name="currentPassword" type="password" autoComplete="current-password" error={errors.currentPassword} />
            <Field
              label="Nova senha"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              error={errors.newPassword}
              hint={`Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`}
            />
            <Field label="Confirme a nova senha" name="confirmPassword" type="password" autoComplete="new-password" error={errors.confirmPassword} />
            <div>
              <Button type="submit" loading={loading} disabled={!hydrated || hasPassword === null}>
                Alterar senha
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
