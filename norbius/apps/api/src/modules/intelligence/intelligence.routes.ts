import { uuidSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireUser } from "../../plugins/session";
import type { IntelligenceService } from "./intelligence.service";

const idParam = z.object({ id: uuidSchema });

export function registerIntelligenceRoutes(app: FastifyInstance, service: IntelligenceService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  app.get("/api/v1/intelligence", opts, async (req) => service.summary(req.user!.id));
  app.post("/api/v1/intelligence/insights/:id/dismiss", opts, async (req, reply) => {
    await service.dismiss(req.user!.id, idParam.parse(req.params).id);
    return reply.status(204).send();
  });
}
