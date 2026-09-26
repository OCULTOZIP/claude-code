import { addMonths, addMonthsToMonth, clampedDate, compareDates, parts, type IsoDate, type IsoMonth } from "./dates";

export type CardCycle = { closingDay: number; dueDay: number };

export type InvoicePeriod = {
  /** Mês de referência da fatura ("YYYY-MM"): o mês em que ela fecha. */
  referenceMonth: IsoMonth;
  closingDate: IsoDate;
  dueDate: IsoDate;
};

/** Datas da fatura de um mês de referência. Vencimento no mês seguinte se vence antes/no dia do fechamento. */
export function invoiceForMonth(referenceMonth: IsoMonth, cycle: CardCycle): InvoicePeriod {
  const [y, m] = referenceMonth.split("-").map(Number) as [number, number];
  const closingDate = clampedDate(y, m, cycle.closingDay);
  const dueMonth = cycle.dueDay > cycle.closingDay ? referenceMonth : addMonthsToMonth(referenceMonth, 1);
  const [dy, dm] = dueMonth.split("-").map(Number) as [number, number];
  return { referenceMonth, closingDate, dueDate: clampedDate(dy, dm, cycle.dueDay) };
}

/**
 * Fatura em que cai uma compra. Compras feitas no dia do fechamento ou depois
 * entram na fatura seguinte (regra usual dos emissores brasileiros).
 */
export function invoiceForPurchase(purchaseDate: IsoDate, cycle: CardCycle): InvoicePeriod {
  const { year, month } = parts(purchaseDate);
  const thisMonth = `${year}-${String(month).padStart(2, "0")}`;
  const current = invoiceForMonth(thisMonth, cycle);
  return compareDates(purchaseDate, current.closingDate) < 0
    ? current
    : invoiceForMonth(addMonthsToMonth(thisMonth, 1), cycle);
}

export type InstallmentPlan = {
  installmentNumber: number;
  amountCents: number;
  competenceDate: IsoDate;
  invoice: InvoicePeriod;
}[];

/** Parcelas de uma compra, cada uma alocada à sua fatura. */
export function planInstallments(
  purchaseDate: IsoDate,
  amounts: number[],
  cycle: CardCycle,
): InstallmentPlan {
  const first = invoiceForPurchase(purchaseDate, cycle);
  return amounts.map((amountCents, i) => ({
    installmentNumber: i + 1,
    amountCents,
    competenceDate: addMonths(purchaseDate, i),
    invoice: invoiceForMonth(addMonthsToMonth(first.referenceMonth, i), cycle),
  }));
}

export type InvoiceStatus = "open" | "closed" | "paid" | "partially_paid" | "overdue";

/** Status derivado (não armazenado): sempre consistente com datas, total e pagamentos. */
export function invoiceStatus(args: {
  closingDate: IsoDate;
  dueDate: IsoDate;
  totalCents: number;
  paidCents: number;
  today: IsoDate;
}): InvoiceStatus {
  const { closingDate, dueDate, totalCents, paidCents, today } = args;
  if (compareDates(today, closingDate) < 0) return "open";
  if (totalCents > 0 && paidCents >= totalCents) return "paid";
  if (totalCents === 0) return "paid";
  if (compareDates(today, dueDate) > 0) return "overdue";
  return paidCents > 0 ? "partially_paid" : "closed";
}
