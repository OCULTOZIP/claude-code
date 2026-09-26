import { isoDateSchema, recurringConfirmSchema, recurringInputSchema, uuidSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireUser } from "../../plugins/session";
import type { RecurringService } from "./recurring.service";

const idParam = z.object({ id: uuidSchema });

export function registerRecurringRoutes(app: FastifyInstance, service: RecurringService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  const id = (params: unknown) => idParam.parse(params).id;

  app.get("/api/v1/recurring", opts, async (req) => service.list(req.user!.id));
  app.post("/api/v1/recurring", opts, async (req, reply) => {
    reply.status(201);
    return service.create(req.user!.id, recurringInputSchema.parse(req.body), req.id);
  });
  app.put("/api/v1/recurring/:id", opts, async (req) =>
    service.update(req.user!.id, id(req.params), recurringInputSchema.parse(req.body), req.id),
  );
  app.post("/api/v1/recurring/:id/deactivate", opts, async (req) => service.setActive(req.user!.id, id(req.params), false, req.id));
  app.post("/api/v1/recurring/:id/activate", opts, async (req) => service.setActive(req.user!.id, id(req.params), true, req.id));
  app.post("/api/v1/recurring/:id/confirm", opts, async (req) =>
    service.confirm(req.user!.id, id(req.params), recurringConfirmSchema.parse(req.body), req.id),
  );
  app.post("/api/v1/recurring/:id/skip", opts, async (req) => {
    const { date } = z.object({ date: isoDateSchema }).parse(req.body);
    return service.skip(req.user!.id, id(req.params), date, req.id);
  });
}
