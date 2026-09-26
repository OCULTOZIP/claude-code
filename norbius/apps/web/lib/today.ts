import "server-only";
import { todayIn } from "@norbius/domain";
import { getMe } from "./server-api";

/** "Hoje" no fuso do perfil do usuário. */
export async function userToday() {
  const me = await getMe();
  return todayIn(me?.profile.timezone ?? "America/Sao_Paulo");
}
