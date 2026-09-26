import type { AuthConfig } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import type { Env } from "../../env";
import type { Auth } from "../../lib/auth";

/** Monta o handler do Better Auth em /api/auth/* e expõe a configuração pública. */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth, env: Env) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: { rateLimit: false }, // o Better Auth aplica seus próprios limites por rota
    async handler(req, reply) {
      const url = new URL(req.url, env.APP_URL);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      // O Better Auth lê o IP de x-forwarded-for para rate limit e auditoria.
      // Repassamos apenas o IP resolvido pelo Fastify (que respeita
      // TRUST_PROXY_HOPS), impedindo que o cliente forje o próprio IP.
      headers.set("x-forwarded-for", req.ip);
      const hasBody = req.method !== "GET" && req.body !== undefined && req.body !== null;
      const response = await auth.handler(
        new Request(url, { method: req.method, headers, body: hasBody ? JSON.stringify(req.body) : undefined }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      reply.header("cache-control", "no-store");
      return reply.send(response.body ? await response.text() : null);
    },
  });

  app.get("/api/v1/auth/config", async (): Promise<AuthConfig> => ({ providers: { google: env.googleEnabled } }));
}
