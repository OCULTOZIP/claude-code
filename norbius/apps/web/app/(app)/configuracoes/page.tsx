import { ProfileForm } from "@/components/app/profile-form";
import { getMe } from "@/lib/server-api";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const me = await getMe();
  if (!me) redirect("/entrar");
  return (
    <ProfileForm
      displayName={me.profile.displayName ?? me.user.name}
      email={me.user.email}
      createdAt={me.user.createdAt}
    />
  );
}
