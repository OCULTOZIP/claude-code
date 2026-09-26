import { AccountsView } from "@/components/finance/accounts-view";
import { apiGet } from "@/lib/server-api";
import type { AccountView } from "@norbius/contracts";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contas" };

export default async function AccountsPage() {
  const accounts = await apiGet<AccountView[]>("/api/v1/accounts?archived=true");
  return <AccountsView accounts={accounts} />;
}
