import "server-only";
import type { TransactionDialogData } from "@/components/finance/transaction-dialog";
import type { AccountView, CategoryView, CreditCardView } from "@norbius/contracts";
import { apiGet } from "./server-api";

/** Dados de apoio para registrar movimentações (contas, categorias, cartões). */
export async function dialogData(today: string): Promise<TransactionDialogData> {
  const [accounts, categories, cards] = await Promise.all([
    apiGet<AccountView[]>("/api/v1/accounts"),
    apiGet<CategoryView[]>("/api/v1/categories"),
    apiGet<CreditCardView[]>("/api/v1/cards"),
  ]);
  return { accounts, categories, cards, today };
}
