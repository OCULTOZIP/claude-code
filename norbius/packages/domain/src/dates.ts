// Datas de calendário como strings ISO "YYYY-MM-DD", sem fuso horário.
// Evita os erros clássicos de Date (UTC vs. local) em datas financeiras.

export type IsoDate = string;
export type IsoMonth = string; // "YYYY-MM"

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number) as [number, number, number, number];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parts(date: IsoDate): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Data inválida: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function makeDate(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Dia `day` do mês, limitado ao último dia (ex.: dia 31 em fevereiro → 28/29). */
export function clampedDate(year: number, month: number, day: number): IsoDate {
  return makeDate(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Soma meses mantendo o dia desejado (limitado ao fim do mês). */
export function addMonths(date: IsoDate, months: number, preferredDay?: number): IsoDate {
  const { year, month, day } = parts(date);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return clampedDate(y, m, preferredDay ?? day);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parts(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round(
    (Date.UTC(pa.year, pa.month - 1, pa.day) - Date.UTC(pb.year, pb.month - 1, pb.day)) / 86_400_000,
  );
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

export function monthRange(month: IsoMonth): { start: IsoDate; end: IsoDate } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  if (!y || !m || m < 1 || m > 12) throw new Error(`Mês inválido: ${month}`);
  return { start: makeDate(y, m, 1), end: makeDate(y, m, daysInMonth(y, m)) };
}

export function addMonthsToMonth(month: IsoMonth, n: number): IsoMonth {
  return monthOf(addMonths(`${month}-01`, n));
}

/** Data de hoje no fuso do usuário. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  try {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    return f.format(now);
  } catch {
    return todayIn("America/Sao_Paulo", now);
  }
}

/** Data e hora locais (fuso IANA) de um instante. */
export function localParts(now: Date, timeZone: string): { date: IsoDate; hour: number; minute: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** Instante UTC correspondente a `date` às `hour`:00 no fuso (usa o deslocamento vigente naquele dia). */
export function zonedTime(date: IsoDate, hour: number, timeZone: string): Date {
  const { year, month, day } = parts(date);
  const guess = new Date(Date.UTC(year, month - 1, day, hour));
  const seen = localParts(guess, timeZone);
  const [sy, sm, sd] = seen.date.split("-").map(Number) as [number, number, number];
  const seenUtc = Date.UTC(sy, sm - 1, sd, seen.hour, seen.minute);
  return new Date(guess.getTime() - (seenUtc - guess.getTime()));
}

/** Horário silencioso (22h–8h): quando o aviso pode sair. Fora dele, agora mesmo. */
export function afterQuietHours(now: Date, timeZone: string, start = 22, end = 8): Date {
  const { date, hour } = localParts(now, timeZone);
  if (hour >= end && hour < start) return now;
  return zonedTime(hour >= start ? addDays(date, 1) : date, end, timeZone);
}
