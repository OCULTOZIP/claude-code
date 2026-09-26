import { notificationPreferencesSchema, uuidSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireUser } from "../../plugins/session";
import type { NotificationsService } from "./notifications.service";

const idParam = z.object({ id: uuidSchema });

export function registerNotificationRoutes(app: FastifyInstance, service: NotificationsService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  app.get("/api/v1/notifications", opts, async (req) => service.list(req.user!.id));
  app.post("/api/v1/notifications/:id/read", opts, async (req, reply) => {
    await service.markRead(req.user!.id, idParam.parse(req.params).id);
    return reply.status(204).send();
  });
  app.post("/api/v1/notifications/read-all", opts, async (req, reply) => {
    await service.markAllRead(req.user!.id);
    return reply.status(204).send();
  });
  app.get("/api/v1/notifications/preferences", opts, async (req) => service.preferences(req.user!.id));
  app.put("/api/v1/notifications/preferences", opts, async (req) =>
    service.setPreferences(req.user!.id, notificationPreferencesSchema.parse(req.body).preferences),
  );
}
