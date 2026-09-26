import { accountInputSchema, uuidSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireUser } from "../../plugins/session";
import type { AccountsService } from "./accounts.service";

const idParam = z.object({ id: uuidSchema });

export function registerAccountRoutes(app: FastifyInstance, service: AccountsService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  app.get("/api/v1/accounts", opts, async (req) => {
    const { archived } = z.object({ archived: z.enum(["true", "false"]).optional() }).parse(req.query);
    return service.list(req.user!.id, archived === "true");
  });
  app.post("/api/v1/accounts", opts, async (req, reply) => {
    reply.status(201);
    return service.create(req.user!.id, accountInputSchema.parse(req.body), req.id);
  });
  app.put("/api/v1/accounts/:id", opts, async (req) => {
    const { id } = idParam.parse(req.params);
    return service.update(req.user!.id, id, accountInputSchema.parse(req.body), req.id);
  });
  app.post("/api/v1/accounts/:id/archive", opts, async (req) =>
    service.setArchived(req.user!.id, idParam.parse(req.params).id, true, req.id),
  );
  app.post("/api/v1/accounts/:id/unarchive", opts, async (req) =>
    service.setArchived(req.user!.id, idParam.parse(req.params).id, false, req.id),
  );
}
