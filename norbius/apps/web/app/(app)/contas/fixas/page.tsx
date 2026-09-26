import { RecurringView } from "@/components/finance/recurring-view";
import { dialogData } from "@/lib/finance-data";
import { apiGet } from "@/lib/server-api";
import { userToday } from "@/lib/today";
import type { RecurringView as Recurring } from "@norbius/contracts";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contas fixas" };

export default async function RecurringPage() {
  const today = await userToday();
  const [items, data] = await Promise.all([apiGet<Recurring[]>("/api/v1/recurring"), dialogData(today)]);
  return <RecurringView items={items} data={data} />;
}
