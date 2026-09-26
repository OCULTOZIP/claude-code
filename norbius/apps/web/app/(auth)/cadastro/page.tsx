import { SignUpForm } from "@/components/auth/sign-up-form";
import { getAuthConfig } from "@/lib/server-api";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Criar conta" };

export default async function SignUpPage() {
  const config = await getAuthConfig();
  return <SignUpForm googleEnabled={config.providers.google} />;
}
