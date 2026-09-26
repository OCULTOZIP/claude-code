import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireUser } from "../../plugins/session";
import { renderMonthlyPdf } from "./monthly-pdf";
import type { ReportsService } from "./reports.service";

const query = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido (use AAAA-MM)."),
  format: z.enum(["pdf", "json"]).default("pdf"),
});

export function registerReportRoutes(app: FastifyInstance, service: ReportsService, requireUser: RequireUser) {
  const opts = { preHandler: requireUser };
  app.get("/api/v1/reports/months", opts, async (req) => service.months(req.user!.id));
  app.get(
    "/api/v1/reports/monthly",
    { ...opts, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { month, format } = query.parse(req.query);
      const report = await service.monthly(req.user!.id, month);
      if (format === "json") return report;
      const pdf = await renderMonthlyPdf(report);
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="norbius-${month}.pdf"`)
        .header("cache-control", "no-store")
        .send(pdf);
    },
  );
}
