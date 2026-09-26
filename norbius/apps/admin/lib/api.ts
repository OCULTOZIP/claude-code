import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type AdminRole = "support" | "billing" | "analyst" | "superadmin";
export type Admin = { id: string; email: string; name: string; role: AdminRole };

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API respondeu ${status}`);
  }
}

/** Chamada server-side à API admin, repassando o cookie do painel. Sem sessão → tela de login. */
export async function adminGet<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const res = await fetch(`${API_URL}${path}`, { headers: { cookie: cookieStore.toString() }, cache: "no-store" });
  if (res.status === 401) redirect("/entrar");
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

/** Papéis que enxergam cada área (o servidor confere de novo, e o banco também). */
export const CAN = {
  metrics: ["analyst", "billing", "support"],
  customers: ["support", "billing"],
  payments: ["billing"],
  audit: ["support"],
  admins: [],
} as const satisfies Record<string, readonly AdminRole[]>;

export const can = (admin: Admin, area: keyof typeof CAN) => admin.role === "superadmin" || (CAN[area] as readonly AdminRole[]).includes(admin.role);
