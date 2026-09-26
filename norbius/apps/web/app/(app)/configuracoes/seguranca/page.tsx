import { ChangePasswordForm } from "@/components/app/change-password-form";
import { SessionsList } from "@/components/app/sessions-list";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Segurança" };

export default function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <ChangePasswordForm />
      <SessionsList />
    </div>
  );
}
