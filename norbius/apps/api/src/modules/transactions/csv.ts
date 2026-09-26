import type { TransactionView } from "@norbius/contracts";

const TYPE = { income: "Receita", expense: "Despesa", transfer: "Transferência" } as const;

/**
 * Célula CSV segura: aspas escapadas e proteção contra injeção de fórmulas
 * (valores iniciados por = + - @ tab CR viram texto no Excel/Sheets).
 */
export function csvCell(value: string): string {
  const isNumber = /^-?\d+(,\d+)?$/.test(value); // valores monetários negativos não são fórmulas
  const safe = !isNumber && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

const centsToBr = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** CSV em pt-BR (separador ";", vírgula decimal, BOM para acentos no Excel). */
export function transactionsCsv(items: TransactionView[]): string {
  const header = ["Data", "Tipo", "Descrição", "Categoria", "Conta", "Conta de destino", "Valor (R$)"];
  const lines = items.map((t) => {
    const signed = t.type === "expense" || t.type === "transfer" ? -t.amountCents : t.amountCents;
    const [y, m, d] = t.date.split("-");
    return [
      `${d}/${m}/${y}`,
      TYPE[t.type],
      t.description,
      t.category?.name ?? "",
      t.account.name,
      t.transferAccount?.name ?? (t.creditCardInvoiceId ? "Fatura do cartão" : ""),
      centsToBr(signed),
    ]
      .map(csvCell)
      .join(";");
  });
  return `﻿${[header.map(csvCell).join(";"), ...lines].join("\r\n")}\r\n`;
}
