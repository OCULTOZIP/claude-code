import { uuidSchema } from "@norbius/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError, unauthorized } from "../../plugins/errors";
import { SESSION_TTL_MS, type AdminIdentity, type AdminRole, type AdminService } from "./admin.service";

const COOKIE = "norbius_admin";
const idParam = z.object({ id: uuidSchema });
const page = z.coerce.number().int().min(1).max(1000).default(1);
const reason = z.string().trim().min(5, "Informe um motivo com pelo menos 5 caracteres.").max(300);

declare module "fastify" {
  interface FastifyRequest {
    admin: AdminIdentity | null;
  }
}

function readCookie(req: FastifyRequest, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/**
 * Rotas do painel admin (ADR 0007). Só existem com DATABASE_ADMIN_URL. Sessão
 * própria (cookie SameSite=Strict, 8 h), exige a origem do painel em escritas
 * e confere o papel aqui E de novo no banco.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  service: AdminService,
  opts: { adminUrl: string; secureCookie: boolean; rateLimit: boolean },
) {
  app.decorateRequest("admin", null);

  const sameOrigin = async (req: FastifyRequest) => {
    if (req.method !== "GET" && req.headers.origin !== opts.adminUrl) throw new HttpError(403, "FORBIDDEN", "Origem não permitida.");
  };
  const requireAdmin =
    (roles: AdminRole[] = []) =>
    async (req: FastifyRequest) => {
      await sameOrigin(req);
      const admin = await service.session(readCookie(req, COOKIE));
      if (!admin) throw unauthorized();
      if (roles.length) service.assertRole(admin, roles);
      req.admin = admin;
    };
  const setCookie = (reply: FastifyReply, value: string, maxAgeMs: number) =>
    reply.header(
      "set-cookie",
      `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${opts.secureCookie ? "; Secure" : ""}`,
    );
  // Login: 10 tentativas por minuto por IP (além do bloqueio da conta após 5 falhas).
  const strict = opts.rateLimit ? { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } } : {};

  app.post("/api/admin/auth/login", { ...strict, preHandler: sameOrigin }, async (req) => {
    const body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) }).parse(req.body);
    return { challenge: await service.passwordStep(body.email, body.password) };
  });

  app.post("/api/admin/auth/totp", { ...strict, preHandler: sameOrigin }, async (req, reply) => {
    const body = z.object({ challenge: z.string().max(200), code: z.string().trim().max(10) }).parse(req.body);
    const { token, admin } = await service.totpStep(body.challenge, body.code, { ip: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
    setCookie(reply, token, SESSION_TTL_MS);
    return admin;
  });

  app.post("/api/admin/auth/logout", { preHandler: sameOrigin }, async (req, reply) => {
    const token = readCookie(req, COOKIE);
    if (token) await service.logout(token);
    setCookie(reply, "", 0);
    return reply.status(204).send();
  });

  app.get("/api/admin/me", { preHandler: requireAdmin() }, async (req) => req.admin);

  app.get("/api/admin/metrics", { preHandler: requireAdmin(["analyst", "billing", "support"]) }, async () => service.metrics());

  app.get("/api/admin/customers", { preHandler: requireAdmin(["support", "billing"]) }, async (req) => {
    const q = z
      .object({
        search: z.string().trim().max(120).optional(),
        status: z.enum(["active", "suspended", "pending_deletion", "deleted"]).optional(),
        plan: z.enum(["free", "pro"]).optional(),
        page,
      })
      .parse(req.query);
    return service.customers(q);
  });

  app.get("/api/admin/customers/:id", { preHandler: requireAdmin(["support", "billing"]) }, async (req) => {
    const { id } = idParam.parse(req.params);
    await service.audit(req.admin!.id, "admin.user.view", id, {}, req.id, req.ip ?? null);
    return service.customer(id);
  });

  app.post("/api/admin/customers/:id/status", { preHandler: requireAdmin(["support"]) }, async (req, reply) => {
    const body = z.object({ status: z.enum(["active", "suspended"]), reason }).parse(req.body);
    await service.setUserStatus(req.admin!, idParam.parse(req.params).id, body.status, body.reason, req.id);
    return reply.status(204).send();
  });

  app.post("/api/admin/customers/:id/trial", { preHandler: requireAdmin(["billing"]) }, async (req) => {
    const body = z.object({ days: z.number().int().min(1).max(90), reason }).parse(req.body);
    return service.grantTrial(req.admin!, idParam.parse(req.params).id, body.days, body.reason, req.id);
  });

  app.get("/api/admin/grants/:id/transactions", { preHandler: requireAdmin(["support"]) }, async (req) =>
    service.supportTransactions(req.admin!, idParam.parse(req.params).id, req.id),
  );

  app.get("/api/admin/payments", { preHandler: requireAdmin(["billing"]) }, async (req) => service.payments(z.object({ page }).parse(req.query).page));

  app.get("/api/admin/audit", { preHandler: requireAdmin(["support"]) }, async (req) => {
    const q = z.object({ action: z.string().trim().max(80).optional(), userId: uuidSchema.optional(), page }).parse(req.query);
    return service.auditLog(q);
  });

  app.get("/api/admin/admins", { preHandler: requireAdmin([]) }, async (req) => {
    service.assertRole(req.admin!, []);
    return service.admins();
  });

  app.post("/api/admin/admins/:id/active", { preHandler: requireAdmin([]) }, async (req, reply) => {
    const body = z.object({ active: z.boolean() }).parse(req.body);
    await service.setAdminActive(req.admin!, idParam.parse(req.params).id, body.active, req.id);
    return reply.status(204).send();
  });
}
