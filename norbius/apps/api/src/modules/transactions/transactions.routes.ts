import { transactionInputSchema, transactionListQuerySchema, uuidSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireUser } from "../../plugins/session";
import { transactionsCsv } from "./csv";
import type { TransactionsService } from "./transactions.service";

const idParam = z.object({ id: uuidSchema });

export function registerTransactionRoutes(app: FastifyInstance, service: TransactionsService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };

  app.get("/api/v1/transactions", opts, async (req) =>
    service.list(req.user!.id, transactionListQuerySchema.parse(req.query)),
  );

  app.get("/api/v1/transactions/export.csv", { ...opts, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const filters = transactionListQuerySchema.parse(req.query);
    const items = await service.exportAll(req.user!.id, { ...filters, sort: "date_asc" });
    const name = `norbius-transacoes-${filters.month ?? "todas"}.csv`;
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${name}"`)
      .header("cache-control", "no-store");
    return transactionsCsv(items);
  });

  app.get("/api/v1/transactions/:id", opts, async (req) => service.get(req.user!.id, idParam.parse(req.params).id));

  app.post("/api/v1/transactions", opts, async (req, reply) => {
    reply.status(201);
    return service.create(req.user!.id, transactionInputSchema.parse(req.body), req.id);
  });

  app.put("/api/v1/transactions/:id", opts, async (req) =>
    service.update(req.user!.id, idParam.parse(req.params).id, transactionInputSchema.parse(req.body), req.id),
  );

  app.delete("/api/v1/transactions/:id", opts, async (req, reply) => {
    await service.remove(req.user!.id, idParam.parse(req.params).id, req.id);
    return reply.status(204).send();
  });

  app.post("/api/v1/transactions/:id/restore", opts, async (req) =>
    service.restore(req.user!.id, idParam.parse(req.params).id, req.id),
  );
}
