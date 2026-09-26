import type { InvoiceStatusView } from "@norbius/contracts";
import { Badge } from "@norbius/ui";

const LABEL: Record<InvoiceStatusView, string> = {
  open: "Aberta",
  closed: "Fechada",
  paid: "Paga",
  partially_paid: "Paga parcialmente",
  overdue: "Vencida",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatusView }) {
  const tone = status === "overdue" ? "primary" : status === "paid" ? "success" : status === "closed" || status === "partially_paid" ? "warning" : "neutral";
  return <Badge tone={tone}>{LABEL[status]}</Badge>;
}
