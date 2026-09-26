"use client";
import { api, ClientApiError } from "@/lib/client-api";
import { validate, type FieldErrors } from "@/lib/form";
import { updateProfileSchema, type Me } from "@norbius/contracts";
import { Alert, Button, Card, CardBody, Field } from "@norbius/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";

export function ProfileForm({ displayName, email, createdAt }: { displayName: string; email: string; createdAt: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string }>();
  const hydrated = useHydrated();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus(undefined);
    const parsed = validate(updateProfileSchema, { displayName: new FormData(e.currentTarget).get("displayName") });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    setLoading(true);
    try {
      await api<Me>("/me/profile", { method: "PATCH", json: parsed.data });
      setStatus({ tone: "success", text: "Perfil atualizado." });
      router.refresh();
    } catch (err) {
      const fields = err instanceof ClientApiError ? err.body?.error.fields : undefined;
      if (fields) setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[0]])));
      else setStatus({ tone: "error", text: "Não foi possível salvar. Tente novamente." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody className="pt-6">
        <form method="post" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {status ? <Alert tone={status.tone}>{status.text}</Alert> : null}
          <Field
            label="Como o NORBIUS deve chamar você"
            name="displayName"
            defaultValue={displayName}
            autoComplete="nickname"
            maxLength={80}
            error={errors.displayName}
          />
          <Field label="E-mail" value={email} readOnly disabled hint="O e-mail de acesso não pode ser alterado por aqui." />
          <p className="text-xs text-fg-muted">
            Conta criada em {new Date(createdAt).toLocaleDateString("pt-BR", { dateStyle: "long" })}.
          </p>
          <div>
            <Button type="submit" disabled={!hydrated} loading={loading}>
              Salvar
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
