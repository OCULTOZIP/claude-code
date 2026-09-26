"use client";
import { adminPost } from "@/lib/client";
import { Alert, Button, Field, Logo } from "@norbius/ui";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Login em duas etapas: senha e depois o código do app autenticador (obrigatório). */
export function LoginForm() {
  const router = useRouter();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setLoading(true);
    try {
      if (!challenge) {
        const r = await adminPost<{ challenge: string }>("/api/admin/auth/login", { email: form.get("email"), password: form.get("password") });
        setChallenge(r.challenge);
      } else {
        await adminPost("/api/admin/auth/totp", { challenge, code: String(form.get("code") ?? "").replace(/\s/g, "") });
        router.replace("/");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
      if (challenge && err instanceof Error && /expirou/.test(err.message)) setChallenge(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between">
          <Logo />
          <span className="rounded-md border border-primary/60 px-2 py-0.5 font-mono text-[11px] tracking-widest text-primary-light">ADMIN</span>
        </div>
        <form onSubmit={submit} className="mt-10 flex flex-col gap-4 rounded-card border border-line bg-card p-6">
          <h1 className="text-lg font-semibold">{challenge ? "Código do autenticador" : "Acesso restrito"}</h1>
          {error ? <Alert tone="error">{error}</Alert> : null}
          {!challenge ? (
            <>
              <Field key="email" label="E-mail" name="email" type="email" autoComplete="username" required />
              <Field key="password" label="Senha" name="password" type="password" autoComplete="current-password" required />
            </>
          ) : (
            <>
              <p className="flex gap-2 text-sm text-fg-secondary">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> Abra o app autenticador e digite o código de 6 dígitos do NORBIUS Admin.
              </p>
              {/* key própria: sem ela o React reaproveitaria o campo da senha (com o texto digitado) como campo do código. */}
              <Field key="code" label="Código" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} pattern="[0-9 ]{6,7}" autoFocus required />
            </>
          )}
          <Button type="submit" loading={loading}>
            {challenge ? "Entrar" : "Continuar"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-fg-muted">Sessão de 8 horas. Todas as ações ficam registradas.</p>
      </div>
    </main>
  );
}
