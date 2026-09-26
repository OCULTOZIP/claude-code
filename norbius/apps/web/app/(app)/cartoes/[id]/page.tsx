import { InvoiceView as InvoicePanel } from "@/components/finance/invoice-view";
import { dialogData } from "@/lib/finance-data";
import { apiGet } from "@/lib/server-api";
import { userToday } from "@/lib/today";
import type { CreditCardView, InvoiceItemView, InvoiceView } from "@norbius/contracts";
import { invoiceForPurchase } from "@norbius/domain";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Faturas" };

export default async function CardInvoicesPage({ params, searchParams }: PageProps<"/cartoes/[id]">) {
  const [{ id }, sp, today] = await Promise.all([params, searchParams, userToday()]);
  const [card, invoices, data] = await Promise.all([
    apiGet<CreditCardView>(`/api/v1/cards/${id}`),
    apiGet<InvoiceView[]>(`/api/v1/cards/${id}/invoices`),
    dialogData(today),
  ]);
  const current = invoiceForPurchase(today, card).referenceMonth;
  const wanted = typeof sp.fatura === "string" ? sp.fatura : null;
  const selected =
    invoices.find((i) => i.id === wanted) ??
    invoices.find((i) => i.referenceMonth === current) ??
    invoices.find((i) => i.referenceMonth > current) ??
    invoices[0] ??
    null;
  const detail = selected
    ? await apiGet<{ invoice: InvoiceView; items: InvoiceItemView[] }>(`/api/v1/invoices/${selected.id}`)
    : null;
  return <InvoicePanel card={card} invoices={invoices} detail={detail} data={data} />;
}
