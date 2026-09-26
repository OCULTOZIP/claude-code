import { schema, type Transaction } from "@norbius/db";
import { todayIn } from "@norbius/domain";

/** Fuso do usuário (perfil) dentro do contexto RLS. */
export async function userTimezone(tx: Transaction): Promise<string> {
  const [row] = await tx.select({ timezone: schema.profiles.timezone }).from(schema.profiles).limit(1);
  return row?.timezone ?? "America/Sao_Paulo";
}

/** "Hoje" no fuso do usuário: base de saldos, faturas e recorrências. */
export async function userToday(tx: Transaction): Promise<string> {
  return todayIn(await userTimezone(tx));
}
