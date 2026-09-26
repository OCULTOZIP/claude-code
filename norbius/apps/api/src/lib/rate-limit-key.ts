import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

export const INTERNAL_HEADER = "x-norbius-internal";
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?norbius\.session_token=([^;]+)/;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Chave do rate limit global.
 *
 * Requisições do navegador (via rewrite do Next) são limitadas pelo IP do
 * cliente. Já o SSR do Next chama a API a partir do próprio servidor — todas
 * com o mesmo IP, e sem como repassar um IP de cliente confiável. Por isso o
 * SSR se identifica com `INTERNAL_API_SECRET` e é limitado pela sessão do
 * usuário; sem sessão, cai no IP do servidor. Sem o segredo válido, o
 * cabeçalho é ignorado.
 */
export function rateLimitKey(req: FastifyRequest, internalSecret: string | undefined): string {
  const header = req.headers[INTERNAL_HEADER];
  if (internalSecret && typeof header === "string" && sameSecret(header, internalSecret)) {
    const token = req.headers.cookie?.match(SESSION_COOKIE)?.[1];
    if (token) return `ssr:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
  }
  return req.ip;
}
