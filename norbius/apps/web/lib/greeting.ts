/** Saudação conforme a hora local do usuário (fuso do perfil). */
export function greeting(timezone: string, now = new Date()) {
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(now));
  } catch {
    hour = now.getUTCHours() - 3;
  }
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}
