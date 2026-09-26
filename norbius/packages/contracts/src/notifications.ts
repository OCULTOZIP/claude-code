import { z } from "zod";

export const NOTIFICATION_TYPES = ["bill_due", "card_limit", "unusual_spending", "financial_summary", "goal_reached", "insight"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Rótulos e padrão de cada tipo (usado quando o usuário ainda não mexeu nas preferências). */
export const NOTIFICATION_TYPE_INFO: Record<NotificationType, { label: string; description: string; inApp: boolean; email: boolean }> = {
  bill_due: { label: "Contas e faturas a vencer", description: "Até 3 dias antes do vencimento e faturas vencidas.", inApp: true, email: true },
  card_limit: { label: "Limite do cartão", description: "Quando o uso passa de 80% do limite.", inApp: true, email: true },
  unusual_spending: { label: "Gastos fora do padrão", description: "Transações bem acima do seu gasto típico na categoria.", inApp: true, email: true },
  financial_summary: { label: "Resumo do mês", description: "Receitas, despesas e maior categoria do mês anterior.", inApp: true, email: true },
  goal_reached: { label: "Metas atingidas", description: "Quando uma meta chega ao valor-alvo.", inApp: true, email: false },
  insight: {
    label: "Outras análises",
    description: "Categoria em alta, saldo projetado negativo, metas fora do ritmo, assinaturas e contas mensais não cadastradas.",
    inApp: true,
    email: false,
  },
};

/** Tipo de insight → tipo de notificação (BLUEPRINT §4.7). */
export function notificationTypeFor(insightType: string): NotificationType {
  switch (insightType) {
    case "bill_due":
    case "card_limit":
    case "goal_reached":
      return insightType;
    case "anomaly":
      return "unusual_spending";
    case "monthly_summary":
      return "financial_summary";
    default:
      return "insight";
  }
}

export type NotificationView = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  severity: "info" | "opportunity" | "attention" | "critical" | null;
  read: boolean;
  createdAt: string;
};

export type NotificationsList = { unread: number; items: NotificationView[] };

export type NotificationPreference = { type: NotificationType; inApp: boolean; email: boolean };

export const notificationPreferencesSchema = z.object({
  preferences: z
    .array(z.object({ type: z.enum(NOTIFICATION_TYPES), inApp: z.boolean(), email: z.boolean() }))
    .min(1)
    .max(NOTIFICATION_TYPES.length),
});
