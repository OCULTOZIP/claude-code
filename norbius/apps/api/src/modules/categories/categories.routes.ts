import { categoryInputSchema, uuidSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireUser } from "../../plugins/session";
import type { CategoriesService } from "./categories.service";

const idParam = z.object({ id: uuidSchema });

export function registerCategoryRoutes(app: FastifyInstance, service: CategoriesService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  app.get("/api/v1/categories", opts, async (req) => service.list(req.user!.id));
  app.post("/api/v1/categories", opts, async (req, reply) => {
    reply.status(201);
    return service.create(req.user!.id, categoryInputSchema.parse(req.body));
  });
  app.patch("/api/v1/categories/:id", opts, async (req) => {
    const { name } = categoryInputSchema.pick({ name: true }).parse(req.body);
    return service.rename(req.user!.id, idParam.parse(req.params).id, name);
  });
  app.post("/api/v1/categories/:id/archive", opts, async (req) =>
    service.archive(req.user!.id, idParam.parse(req.params).id),
  );
}
