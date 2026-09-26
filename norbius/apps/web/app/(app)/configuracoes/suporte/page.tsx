import { SupportGrants, type Grant } from "@/components/app/support-grants";
import { apiGet } from "@/lib/server-api";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Suporte" };

export default async function SupportSettingsPage() {
  return <SupportGrants initial={await apiGet<Grant[]>("/api/v1/support/grants")} />;
}
