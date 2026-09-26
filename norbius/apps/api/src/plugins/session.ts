import type { FastifyInstance, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../lib/auth";
import { unauthorized } from "./errors";

export type AuthenticatedUser = { id: string; email: string; name: string; emailVerified: boolean };

declare module "fastify" {
  interface FastifyRequest {
    /** Usuário da sessão, preenchido por `requireUser`. Nunca vem do corpo da requisição. */
    user: AuthenticatedUser | null;
  }
}

export function registerSession(app: FastifyInstance, auth: Auth) {
  app.decorateRequest("user", null);

  /** preHandler que exige sessão válida e e-mail verificado. */
  return async function requireUser(req: FastifyRequest) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session || !session.user.emailVerified) throw unauthorized();
    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      emailVerified: session.user.emailVerified,
    };
  };
}

export type RequireUser = ReturnType<typeof registerSession>;
