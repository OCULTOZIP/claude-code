import { checkoutInputSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { RequireUser } from "../../plugins/session";
import type { BillingService } from "./billing.service";
import { parseAsaasEvent } from "./webhook";

function sameToken(given: unknown, expected: string | undefined): boolean {
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerBillingRoutes(
  app: FastifyInstance,
  billing: BillingService,
  requireUser: RequireUser,
  opts: { webhookToken: string | undefined; providerName: string | null },
) {
  const auth = { preHandler: requireUser };

  app.get("/api/v1/billing", auth, async (req) => billing.overview(req.user!.id));
  app.post("/api/v1/billing/trial", auth, async (req) => billing.startTrial(req.user!.id, req.id));
  app.post(
    "/api/v1/billing/checkout",
    { ...auth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => billing.checkout(req.user!.id, checkoutInputSchema.parse(req.body), req.id),
  );
  app.post("/api/v1/billing/cancel", auth, async (req) => billing.cancel(req.user!.id, req.id));

  // Webhook do Asaas: autenticado pelo token configurado no painel do Asaas.
  // Responde 200 para eventos que não nos interessam (senão o Asaas pausa a fila).
  app.post("/api/v1/billing/webhooks/asaas", { config: { rateLimit: false } }, async (req, reply) => {
    if (!opts.webhookToken || !opts.providerName) return reply.status(503).send({ error: { code: "BILLING_UNAVAILABLE", message: "Pagamento não configurado." } });
    if (!sameToken(req.headers["asaas-access-token"], opts.webhookToken)) {
      return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Token inválido." } });
    }
    const event = parseAsaasEvent(req.body);
    if (!event) return reply.status(400).send({ error: { code: "INVALID_EVENT", message: "Evento inválido." } });
    const outcome = await billing.handleEvent(event, opts.providerName);
    return { received: true, outcome };
  });
}
