import "server-only";
import type { AuthConfig, Me } from "@norbius/contracts";
import { cookies, headers } from "next/headers";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export class ApiRequestError extends Error {
  constructor(readonly status: number) {
    super(`API respondeu ${status}`);
  }
}

/** Chamada server-side à API, repassando o cookie de sessão do usuário. */
async function apiFetch<T>(path: string): Promise<T> {
  const [cookieStore, h] = await Promise.all([cookies(), headers()]);
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      cookie: cookieStore.toString(),
      "x-request-id": h.get("x-request-id") ?? crypto.randomUUID(),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new ApiRequestError(res.status);
  return (await res.json()) as T;
}

/** Usuário autenticado ou `null` se a sessão for inválida. */
export async function getMe(): Promise<Me | null> {
  try {
    return await apiFetch<Me>("/api/v1/me");
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) return null;
    throw err;
  }
}

export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/config`, { next: { revalidate: 300 } });
    if (res.ok) return (await res.json()) as AuthConfig;
  } catch {
    // API indisponível: esconde provedores opcionais em vez de mostrar botão quebrado.
  }
  return { providers: { google: false } };
}
