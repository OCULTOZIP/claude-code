import { creditCardInputSchema, invoicePaymentSchema, purchaseInputSchema, uuidSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireUser } from "../../plugins/session";
import type { CardsService } from "./cards.service";

const idParam = z.object({ id: uuidSchema });

export function registerCardRoutes(app: FastifyInstance, service: CardsService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  const id = (params: unknown) => idParam.parse(params).id;

  app.get("/api/v1/cards", opts, async (req) => {
    const { archived } = z.object({ archived: z.enum(["true", "false"]).optional() }).parse(req.query);
    return service.list(req.user!.id, archived === "true");
  });
  app.get("/api/v1/cards/:id", opts, async (req) => service.get(req.user!.id, id(req.params)));
  app.post("/api/v1/cards", opts, async (req, reply) => {
    reply.status(201);
    return service.create(req.user!.id, creditCardInputSchema.parse(req.body), req.id);
  });
  app.put("/api/v1/cards/:id", opts, async (req) =>
    service.update(req.user!.id, id(req.params), creditCardInputSchema.parse(req.body), req.id),
  );
  app.post("/api/v1/cards/:id/archive", opts, async (req) => service.setArchived(req.user!.id, id(req.params), true, req.id));
  app.post("/api/v1/cards/:id/unarchive", opts, async (req) => service.setArchived(req.user!.id, id(req.params), false, req.id));
  app.get("/api/v1/cards/:id/invoices", opts, async (req) => service.listInvoices(req.user!.id, id(req.params)));

  app.get("/api/v1/invoices/:id", opts, async (req) => service.getInvoice(req.user!.id, id(req.params)));
  app.post("/api/v1/invoices/:id/payments", opts, async (req) =>
    service.payInvoice(req.user!.id, id(req.params), invoicePaymentSchema.parse(req.body), req.id),
  );

  app.post("/api/v1/card-purchases", opts, async (req, reply) => {
    reply.status(201);
    return service.createPurchase(req.user!.id, purchaseInputSchema.parse(req.body), req.id);
  });
  app.get("/api/v1/card-purchases/:id", opts, async (req) => service.getPurchase(req.user!.id, id(req.params)));
  app.put("/api/v1/card-purchases/:id", opts, async (req) =>
    service.updatePurchase(req.user!.id, id(req.params), purchaseInputSchema.parse(req.body), req.id),
  );
  app.delete("/api/v1/card-purchases/:id", opts, async (req, reply) => {
    await service.setPurchaseDeleted(req.user!.id, id(req.params), true, req.id);
    return reply.status(204).send();
  });
  app.post("/api/v1/card-purchases/:id/restore", opts, async (req, reply) => {
    await service.setPurchaseDeleted(req.user!.id, id(req.params), false, req.id);
    return reply.status(204).send();
  });
}
