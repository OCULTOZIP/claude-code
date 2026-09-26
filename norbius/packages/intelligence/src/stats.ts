import { parts, type IsoDate } from "@norbius/domain";

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Desvio absoluto mediano (MAD). */
export function mad(values: readonly number[], center = median(values)): number {
  return median(values.map((v) => Math.abs(v - center)));
}

/** Percentil p (0–1) por interpolação linear; `sorted` precisa estar em ordem crescente. */
export function percentileSorted(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Z-score robusto (Iglewicz–Hoaglin): 0,6745·(x − mediana)/MAD. */
export function robustZ(x: number, center: number, madValue: number): number {
  return madValue === 0 ? 0 : (0.6745 * (x - center)) / madValue;
}

/** Gerador pseudoaleatório com semente (mulberry32): a projeção é reproduzível. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits (semente e `inputs_hash`). */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Dia da semana (0 = domingo). */
export function weekday(date: IsoDate): number {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Descrição normalizada para comparar lançamentos ("Netflix.com 12/09" → "netflix com"). */
export function normalizeDescription(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
