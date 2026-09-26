import type { z } from "zod";
import type { AuditLogger } from "../../../lib/audit";
import type { AccountsService } from "../../accounts/accounts.service";
import type { BillingService } from "../../billing/billing.service";
import type { CardsService } from "../../cards/cards.service";
import type { CategoriesService } from "../../categories/categories.service";
import type { DashboardService } from "../../dashboard/dashboard.service";
import type { GoalsService } from "../../goals/goals.service";
import type { RecurringService } from "../../recurring/recurring.service";
import type { TransactionsService } from "../../transactions/transactions.service";
import type { MemoriesService } from "../memories.service";

export type Services = {
  accounts: AccountsService;
  categories: CategoriesService;
  transactions: TransactionsService;
  cards: CardsService;
  goals: GoalsService;
  recurring: RecurringService;
  dashboard: DashboardService;
  memories: MemoriesService;
  audit: AuditLogger;
  billing: BillingService;
};

export type ToolContext = {
  userId: string;
  requestId: string;
  conversationId: string;
  today: string;
  services: Services;
};

/** Cartão exibido no chat para cada ação (fonte da verdade para a UI). */
export type ActionCard = {
  kind: "created" | "pending" | "updated";
  title: string;
  lines: string[];
  /** Desfazer (ações executadas direto). */
  undo?: { method: "DELETE" | "POST"; path: string } | undefined;
  /** Ações que aguardam confirmação. */
  actionId?: string | undefined;
};

export type ToolRun = { result: unknown; card?: ActionCard | undefined };

/**
 * read: executa direto · write: executa e oferece desfazer ·
 * confirm: vira ação pendente; só executa após clique do usuário.
 */
export type ToolMode = "read" | "write" | "confirm";

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  mode: ToolMode;
  /** Para "confirm": prévia exibida ao usuário antes de executar. */
  preview?: (ctx: ToolContext, input: z.infer<S>) => Promise<{ title: string; lines: string[] } | ToolRun>;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolRun>;
};

export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}
