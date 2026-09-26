import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, TestClient, uniqueEmail } from "./helpers";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => {
  ctx = await createTestApp({ AUTH_RATE_LIMIT_ENABLED: "true" });
});
afterAll(() => ctx.close());

describe("rate limit de autenticação", () => {
  it("bloqueia tentativas excessivas de login por IP", async () => {
    const client = new TestClient(ctx.app);
    const email = uniqueEmail("brute");
    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await client.request({
        method: "POST",
        url: "/api/auth/sign-in/email",
        payload: { email, password: "tentativa-errada-1" },
        headers: { "x-forwarded-for": ip },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("IP para rate limit", () => {
  // Em produção o proxy confiável acrescenta o IP real ao fim de
  // x-forwarded-for; o início é controlado pelo cliente.
  const attempt = (client: TestClient, email: string, xff: string) =>
    client.request({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email, password: "tentativa-errada-1" },
      headers: { "x-forwarded-for": xff },
    });

  it("limita pelo IP real e não por valores forjados, sem bucket compartilhado", async () => {
    const email = uniqueEmail("spoof");
    const attacker = new TestClient(ctx.app);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await attempt(attacker, email, `203.0.113.${i}, 10.201.1.1`)).statusCode;
    expect(last).toBe(429);

    // Outro usuário, atrás do mesmo proxy, não pode ser afetado pelo atacante.
    const victim = await attempt(new TestClient(ctx.app), email, "198.51.100.1, 10.202.2.2");
    expect(victim.statusCode).toBe(401);
  });
});
