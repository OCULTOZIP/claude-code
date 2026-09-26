import { getMe } from "@/lib/server-api";
import { Logo } from "@norbius/ui";
import { redirect } from "next/navigation";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/entrar");
  if (me.profile.onboardingStatus === "completed" || me.profile.onboardingStatus === "skipped") redirect("/dashboard");
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip">
      <div className="pointer-events-none absolute -top-72 left-1/2 h-[30rem] w-[44rem] -translate-x-1/2 rounded-full bg-primary/8 blur-3xl" />
      <header className="relative mx-auto flex h-16 w-full max-w-2xl items-center px-4">
        <Logo />
      </header>
      <main className="relative mx-auto w-full max-w-2xl flex-1 px-4 pb-16">{children}</main>
    </div>
  );
}
