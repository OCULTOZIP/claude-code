import { formatBRL } from "@norbius/domain";

export const brl = formatBRL;
export const date = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
export const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
export const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
export const int = (n: number) => n.toLocaleString("pt-BR");
