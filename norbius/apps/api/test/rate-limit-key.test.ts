import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { rateLimitKey } from "../src/lib/rate-limit-key";

const SECRET = "s".repeat(40);
const req = (headers: Record<string, string>, ip = "10.0.0.5") => ({ headers, ip }) as unknown as FastifyRequest;

describe("chave do rate limit global", () => {
  it("SSR autenticado com o segredo é limitado pela sessão, não pelo IP do servidor", () => {
    const a = rateLimitKey(req({ "x-norbius-internal": SECRET, cookie: "theme=dark; norbius.session_token=aaa.sig" }), SECRET);
    const b = rateLimitKey(req({ "x-norbius-internal": SECRET, cookie: "__Secure-norbius.session_token=bbb.sig" }), SECRET);
    expect(a).toMatch(/^ssr:[0-9a-f]{32}$/);
    expect(b).toMatch(/^ssr:/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("aaa");
  });

  it("ignora o cabeçalho sem o segredo correto ou sem segredo configurado", () => {
    const cookie = "norbius.session_token=aaa.sig";
    expect(rateLimitKey(req({ "x-norbius-internal": "errado", cookie }), SECRET)).toBe("10.0.0.5");
    expect(rateLimitKey(req({ "x-norbius-internal": SECRET, cookie }), undefined)).toBe("10.0.0.5");
    expect(rateLimitKey(req({ cookie }), SECRET)).toBe("10.0.0.5");
  });

  it("SSR sem sessão usa o IP", () => {
    expect(rateLimitKey(req({ "x-norbius-internal": SECRET }), SECRET)).toBe("10.0.0.5");
  });
});
