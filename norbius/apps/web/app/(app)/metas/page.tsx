import { GoalsView } from "@/components/finance/goals-view";
import { apiGet } from "@/lib/server-api";
import { userToday } from "@/lib/today";
import type { GoalView } from "@norbius/contracts";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Metas" };

export default async function GoalsPage() {
  const [goals, today] = await Promise.all([apiGet<GoalView[]>("/api/v1/goals?archived=true"), userToday()]);
  return <GoalsView goals={goals} today={today} />;
}
