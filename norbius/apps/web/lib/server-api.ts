import "server-only";
import type { AuthConfig, Me } from "@norbius/contracts";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

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
      // Identifica o SSR para a API limitar por sessão, não pelo IP deste servidor.
      ...(INTERNAL_API_SECRET ? { "x-norbius-internal": INTERNAL_API_SECRET } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new ApiRequestError(res.status);
  return (await res.json()) as T;
}

/**
 * GET autenticado para páginas da área logada. Sessão inválida redireciona
 * para o login; outros erros sobem para a página de erro.
 */
export async function apiGet<T>(path: string): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) redirect("/entrar");
    throw err;
  }
}

/** Usuário autenticado ou `null` se a sessão for inválida. */
export async function getMe(): Promise<Me | null> {
  // Sem cookie de sessão não há o que perguntar à API (e o visitante anônimo não consome o limite do SSR).
  const cookieStore = await cookies();
  if (!cookieStore.getAll().some((c) => c.name.endsWith("norbius.session_token"))) return null;
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
