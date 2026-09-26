import { addDays, addMonths, compareDates, parts, type IsoDate } from "./dates";

export type Frequency = "weekly" | "biweekly" | "monthly" | "yearly";

export type RecurrenceRule = {
  frequency: Frequency;
  startDate: IsoDate;
  /** Dia preferido do mês (mensal/anual). Padrão: dia de startDate. */
  dayOfMonth?: number | null;
  endDate?: IsoDate | null;
};

function nth(rule: RecurrenceRule, n: number): IsoDate {
  const day = rule.dayOfMonth ?? parts(rule.startDate).day;
  switch (rule.frequency) {
    case "weekly":
      return addDays(rule.startDate, 7 * n);
    case "biweekly":
      return addDays(rule.startDate, 14 * n);
    case "monthly":
      return addMonths(rule.startDate, n, day);
    case "yearly":
      return addMonths(rule.startDate, 12 * n, day);
  }
}

/** Ocorrências no intervalo [from, to], em ordem. Limite de segurança de 400 itens. */
export function occurrencesBetween(rule: RecurrenceRule, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let n = 0; n < 5000 && out.length < 400; n++) {
    const date = nth(rule, n);
    if (rule.endDate && compareDates(date, rule.endDate) > 0) break;
    if (compareDates(date, to) > 0) break;
    if (compareDates(date, from) >= 0) out.push(date);
  }
  return out;
}

/** Primeira ocorrência em ou após `date`, ou null se a recorrência já terminou. */
export function nextOccurrence(rule: RecurrenceRule, date: IsoDate): IsoDate | null {
  for (let n = 0; n < 5000; n++) {
    const d = nth(rule, n);
    if (rule.endDate && compareDates(d, rule.endDate) > 0) return null;
    if (compareDates(d, date) >= 0) return d;
  }
  return null;
}

/** Equivalente mensal aproximado (para resumos). */
export function monthlyEquivalentCents(amountCents: number, frequency: Frequency): number {
  switch (frequency) {
    case "weekly":
      return Math.round((amountCents * 52) / 12);
    case "biweekly":
      return Math.round((amountCents * 26) / 12);
    case "monthly":
      return amountCents;
    case "yearly":
      return Math.round(amountCents / 12);
  }
}
