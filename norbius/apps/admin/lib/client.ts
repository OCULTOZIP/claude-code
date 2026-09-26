"use client";

/** Chamada do navegador à API admin (mesma origem; cookie SameSite=Strict). */
export async function adminPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(err?.error?.message ?? `Erro ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function adminFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(err?.error?.message ?? `Erro ${res.status}`);
  }
  return (await res.json()) as T;
}
