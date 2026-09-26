import { AppShell } from "@/components/app/app-shell";
import { getMe } from "@/lib/server-api";
import { redirect } from "next/navigation";

// Área protegida: a sessão é validada na API a cada renderização.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/entrar");
  return (
    <AppShell name={me.profile.displayName ?? me.user.name} email={me.user.email}>
      {children}
    </AppShell>
  );
}
