import { LoginForm } from "@/components/login-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return <LoginForm />;
}
