import { OnboardingChat } from "@/components/onboarding/onboarding-chat";
import { apiGet, getMe } from "@/lib/server-api";
import type { OnboardingState } from "@norbius/contracts";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Primeiros passos" };

export default async function OnboardingPage() {
  const [me, state] = await Promise.all([getMe(), apiGet<OnboardingState>("/api/v1/onboarding")]);
  if (!me) redirect("/entrar");
  return <OnboardingChat initialName={me.profile.displayName ?? me.user.name} draft={state.draft} />;
}
