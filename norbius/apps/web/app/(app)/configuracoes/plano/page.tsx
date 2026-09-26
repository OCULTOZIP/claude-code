import { PlanView } from "@/components/billing/plan-view";
import { apiGet } from "@/lib/server-api";
import type { BillingOverview } from "@norbius/contracts";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Plano" };

export default async function PlanPage() {
  return <PlanView overview={await apiGet<BillingOverview>("/api/v1/billing")} />;
}
