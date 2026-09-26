import { formatBRL } from "@norbius/domain";

export const brl = formatBRL;

/** Valor com sinal para exibição (+ receita, − despesa). */
export function signedBrl(cents: number, type: "income" | "expense" | "transfer") {
  if (type === "income") return `+ ${formatBRL(cents)}`;
  if (type === "expense") return `− ${formatBRL(cents)}`;
  return formatBRL(cents);
}

export function shortDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}${y && y !== String(new Date().getFullYear()) ? `/${y}` : ""}`;
}

export function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", timeZone: "UTC" });
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "Hoje", "Ontem", "Amanhã" ou data curta, relativo ao "hoje" do usuário. */
export function relativeDay(iso: string, today: string) {
  const diff = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === -1) return "Ontem";
  if (diff === 1) return "Amanhã";
  return shortDate(iso);
}
