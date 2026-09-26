import type { FastifyInstance } from "fastify";
import type { RequireUser } from "../../plugins/session";
import type { DashboardService } from "./dashboard.service";

export function registerDashboardRoutes(app: FastifyInstance, service: DashboardService, requireUser: RequireUser) {
  app.get("/api/v1/dashboard/summary", { preHandler: requireUser }, async (req) => service.summary(req.user!.id));
}
