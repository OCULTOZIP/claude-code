import { updateProfileSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import type { RequireUser } from "../../plugins/session";
import type { MeService } from "./me.service";

export function registerMeRoutes(app: FastifyInstance, service: MeService, requireUser: RequireUser) {
  app.get("/api/v1/me", { preHandler: requireUser }, async (req) => service.getMe(req.user!.id));

  app.patch("/api/v1/me/profile", { preHandler: requireUser }, async (req) => {
    const input = updateProfileSchema.parse(req.body);
    return service.updateProfile(req.user!.id, input, req.id);
  });
}
