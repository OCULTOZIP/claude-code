import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Nova senha" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/redefinir-senha">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;
  const invalid = typeof params.error === "string" || !token;
  return <ResetPasswordForm token={invalid ? null : token} />;
}
