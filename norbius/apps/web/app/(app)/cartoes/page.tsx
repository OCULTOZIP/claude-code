import { CardsView } from "@/components/finance/cards-view";
import { dialogData } from "@/lib/finance-data";
import { apiGet } from "@/lib/server-api";
import { userToday } from "@/lib/today";
import type { CreditCardView } from "@norbius/contracts";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cartões" };

export default async function CardsPage() {
  const today = await userToday();
  const [cards, data] = await Promise.all([apiGet<CreditCardView[]>("/api/v1/cards?archived=true"), dialogData(today)]);
  return <CardsView cards={cards} data={data} />;
}
