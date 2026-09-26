/** Normaliza para comparação: minúsculas, sem acentos, espaços simples. */
export function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type Resolution<T> =
  | { ok: true; item: T }
  | { ok: false; reason: "not_found" | "ambiguous"; options: string[] };

/**
 * Resolução determinística de nomes ditos pelo usuário (conta, cartão,
 * categoria, meta): exato → começa com → contém. Ambiguidade nunca é
 * resolvida no chute — volta para o usuário escolher.
 */
export function resolveByName<T extends { name: string }>(items: T[], query: string | undefined | null): Resolution<T> {
  const options = items.map((i) => i.name);
  if (!query) {
    return items.length === 1 ? { ok: true, item: items[0]! } : { ok: false, reason: items.length ? "ambiguous" : "not_found", options };
  }
  const q = normalize(query);
  for (const test of [(n: string) => n === q, (n: string) => n.startsWith(q), (n: string) => n.includes(q) || q.includes(n)]) {
    const hits = items.filter((i) => test(normalize(i.name)));
    if (hits.length === 1) return { ok: true, item: hits[0]! };
    if (hits.length > 1) return { ok: false, reason: "ambiguous", options: hits.map((h) => h.name) };
  }
  return { ok: false, reason: "not_found", options };
}
