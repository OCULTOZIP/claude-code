import { TransactionsView } from "@/components/finance/transactions-view";
import { dialogData } from "@/lib/finance-data";
import { apiGet } from "@/lib/server-api";
import { userToday } from "@/lib/today";
import type { TransactionList } from "@norbius/contracts";
import { monthOf } from "@norbius/domain";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Transações" };

const KEYS = ["month", "type", "accountId", "categoryId", "q", "sort", "page"] as const;

export default async function TransactionsPage({ searchParams }: PageProps<"/transacoes">) {
  const params = await searchParams;
  const today = await userToday();
  const filters: Record<string, string> = {};
  for (const k of KEYS) {
    const v = params[k];
    if (typeof v === "string" && v) filters[k] = v;
  }
  filters.month ??= monthOf(today);
  const query = new URLSearchParams(filters).toString();
  const [list, data] = await Promise.all([apiGet<TransactionList>(`/api/v1/transactions?${query}`), dialogData(today)]);
  return <TransactionsView list={list} filters={filters} data={data} />;
}
