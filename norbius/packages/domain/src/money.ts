// Valores monetários sempre em centavos inteiros. Nunca float para dinheiro.

export const MAX_AMOUNT_CENTS = 100_000_000_000; // R$ 1 bilhão por lançamento

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number): string {
  // Intl usa espaço não separável; normalizamos para espaço comum.
  return brl.format(cents / 100).replace(/ /g, " ");
}

/**
 * Converte texto em pt-BR para centavos.
 * Aceita "1.234,56", "1234,56", "R$ 50", "50,5", "3.200", "1234.56".
 * Retorna null se não for um valor válido.
 */
export function parseBRL(input: string): number | null {
  let s = input.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let integer: string;
  let fraction = "";

  if (lastComma >= 0) {
    // Vírgula é o separador decimal pt-BR; pontos são milhares.
    integer = s.slice(0, lastComma).replace(/\./g, "");
    fraction = s.slice(lastComma + 1);
    if (fraction.includes(".")) return null;
  } else if (lastDot >= 0) {
    const after = s.slice(lastDot + 1);
    const dotCount = s.split(".").length - 1;
    // "3.200" / "1.234.567" = milhares; "1234.5" ou "12.34" = decimal.
    if (dotCount > 1 || after.length === 3) {
      if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return null;
      integer = s.replace(/\./g, "");
    } else {
      integer = s.slice(0, lastDot);
      fraction = after;
    }
  } else {
    integer = s;
  }

  if (!/^\d+$/.test(integer) || !/^\d{0,2}$/.test(fraction)) return null;
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Divide o total em parcelas; os centavos restantes vão para a primeira. */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error("Total inválido");
  if (!Number.isInteger(count) || count < 1) throw new Error("Número de parcelas inválido");
  if (count > totalCents) throw new Error("Mais parcelas que centavos");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base));
}
