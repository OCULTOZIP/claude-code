import { contributionInputSchema, goalInputSchema, uuidSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireUser } from "../../plugins/session";
import type { GoalsService } from "./goals.service";

const idParam = z.object({ id: uuidSchema });

export function registerGoalRoutes(app: FastifyInstance, service: GoalsService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  const id = (params: unknown) => idParam.parse(params).id;

  app.get("/api/v1/goals", opts, async (req) => {
    const { archived } = z.object({ archived: z.enum(["true", "false"]).optional() }).parse(req.query);
    return service.list(req.user!.id, archived === "true");
  });
  app.post("/api/v1/goals", opts, async (req, reply) => {
    reply.status(201);
    return service.create(req.user!.id, goalInputSchema.parse(req.body), req.id);
  });
  app.put("/api/v1/goals/:id", opts, async (req) => service.update(req.user!.id, id(req.params), goalInputSchema.parse(req.body), req.id));
  app.post("/api/v1/goals/:id/archive", opts, async (req) => service.setArchived(req.user!.id, id(req.params), true, req.id));
  app.post("/api/v1/goals/:id/unarchive", opts, async (req) => service.setArchived(req.user!.id, id(req.params), false, req.id));
  app.get("/api/v1/goals/:id/contributions", opts, async (req) => service.contributions(req.user!.id, id(req.params)));
  app.post("/api/v1/goals/:id/contributions", opts, async (req, reply) => {
    reply.status(201);
    return service.contribute(req.user!.id, id(req.params), contributionInputSchema.parse(req.body), req.id);
  });
  app.delete("/api/v1/goals/:id/contributions/:contributionId", opts, async (req) => {
    const { id: goalId, contributionId } = z.object({ id: uuidSchema, contributionId: uuidSchema }).parse(req.params);
    return service.removeContribution(req.user!.id, goalId, contributionId, req.id);
  });
}
