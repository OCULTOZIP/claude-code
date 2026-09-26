import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNext } from "@/lib/form";
import { getAuthConfig } from "@/lib/server-api";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Entrar" };

export default async function SignInPage({ searchParams }: PageProps<"/entrar">) {
  const [params, config] = await Promise.all([searchParams, getAuthConfig()]);
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const initialError = params.erro === "google" ? "Não foi possível entrar com o Google. Tente novamente." : undefined;
  return <SignInForm next={next} googleEnabled={config.providers.google} initialError={initialError} />;
}
