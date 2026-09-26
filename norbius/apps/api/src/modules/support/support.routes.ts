import { uuidSchema } from "@norbius/contracts";
import { schema, withUserContext, type Database } from "@norbius/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditLogger } from "../../lib/audit";
import { notFound } from "../../plugins/errors";
import type { RequireUser } from "../../plugins/session";

const g = schema.supportAccessGrants;
const createBody = z.object({
  reason: z.string().trim().min(5, "Descreva o motivo (ex.: número do chamado).").max(300),
  hours: z.union([z.literal(24), z.literal(72)]),
});

/** Autorizações de acesso do suporte, criadas e revogadas pelo próprio usuário (ADR 0007). */
export function registerSupportRoutes(app: FastifyInstance, db: Database, audit: AuditLogger, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  const view = (r: typeof g.$inferSelect) => ({
    id: r.id,
    scope: r.scope,
    reason: r.reason,
    grantedAt: r.grantedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    active: !r.revokedAt && r.expiresAt > new Date(),
  });

  app.get("/api/v1/support/grants", opts, async (req) =>
    withUserContext(db, req.user!.id, async (tx) => (await tx.select().from(g).orderBy(desc(g.grantedAt)).limit(20)).map(view)),
  );

  app.post("/api/v1/support/grants", opts, async (req, reply) => {
    const body = createBody.parse(req.body);
    const userId = req.user!.id;
    const row = await withUserContext(db, userId, async (tx) => {
      // Uma autorização ativa por vez: a nova substitui as anteriores.
      await tx.update(g).set({ revokedAt: new Date() }).where(and(isNull(g.revokedAt), gt(g.expiresAt, new Date())));
      const [created] = await tx
        .insert(g)
        .values({ userId, scope: ["transactions:read"], reason: body.reason, expiresAt: new Date(Date.now() + body.hours * 3_600_000) })
        .returning();
      return created!;
    });
    await audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "support.grant.create", entityType: "support_access_grant", entityId: row.id, metadata: { hours: body.hours }, requestId: req.id });
    return reply.status(201).send(view(row));
  });

  app.post("/api/v1/support/grants/:id/revoke", opts, async (req, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(req.params);
    const userId = req.user!.id;
    const [row] = await withUserContext(db, userId, (tx) =>
      tx.update(g).set({ revokedAt: new Date() }).where(and(eq(g.id, id), isNull(g.revokedAt))).returning({ id: g.id }),
    );
    if (!row) throw notFound("Autorização");
    await audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "support.grant.revoke", entityType: "support_access_grant", entityId: id, requestId: req.id });
    return reply.status(204).send();
  });
}
