import { uuidSchema } from "@norbius/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../plugins/errors";
import type { RequireUser } from "../../plugins/session";
import type { MemoriesService } from "./memories.service";
import type { AiOrchestrator, ChatEvent } from "./orchestrator";

const idParam = z.object({ id: uuidSchema });
const chatBody = z.object({
  conversationId: uuidSchema.optional(),
  message: z.string().trim().min(1, "Escreva uma mensagem.").max(2000, "Mensagem muito longa (máx. 2000 caracteres)."),
  /** Turno falado (modo ligação): resposta curta, sem formatação, com esforço baixo. */
  voice: z.boolean().optional(),
});

export function registerAiRoutes(
  app: FastifyInstance,
  ai: AiOrchestrator,
  memories: MemoriesService,
  requireUser: RequireUser,
  model: string,
) {
  const opts = { preHandler: requireUser };
  const id = (p: unknown) => idParam.parse(p).id;

  app.get("/api/v1/ai/status", opts, async (req) => ({
    available: ai.available,
    model: ai.available ? model : null,
    /** O plano do usuário inclui o assistente (Pro ou teste grátis). */
    included: (await ai.entitlements(req.user!.id)).assistant,
    usage: await ai.usage(req.user!.id),
  }));

  app.get("/api/v1/ai/conversations", opts, async (req) => ai.listConversations(req.user!.id));
  app.get("/api/v1/ai/conversations/:id", opts, async (req) => ai.conversation(req.user!.id, id(req.params)));
  app.post("/api/v1/ai/conversations/:id/archive", opts, async (req, reply) => {
    await ai.archiveConversation(req.user!.id, id(req.params));
    return reply.status(204).send();
  });

  /**
   * Chat em streaming (SSE). Erros antes do primeiro evento (validação,
   * cota, assistente indisponível) respondem JSON normal; depois disso, um
   * evento "error" encerra o stream.
   */
  app.post(
    "/api/v1/ai/chat",
    { ...opts, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = chatBody.parse(req.body);
      let started = false;
      const send = (event: ChatEvent | { type: "error"; code: string; message: string }) => {
        if (!started) {
          reply.hijack();
          reply.raw.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
            "x-request-id": req.id,
          });
          started = true;
        }
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      try {
        await ai.chat(req.user!.id, body, req.id, send);
      } catch (err) {
        if (!started) throw err;
        req.log.error({ err }, "falha no chat");
        const message = err instanceof HttpError ? err.message : "Algo deu errado. Tente novamente.";
        send({ type: "error", code: err instanceof HttpError ? err.code : "INTERNAL_ERROR", message });
      } finally {
        if (started) reply.raw.end();
      }
    },
  );

  app.post("/api/v1/ai/actions/:id/confirm", opts, async (req) => ai.confirm(req.user!.id, id(req.params), req.id));
  app.post("/api/v1/ai/actions/:id/reject", opts, async (req) => ai.reject(req.user!.id, id(req.params)));

  app.get("/api/v1/ai/memories", opts, async (req) => memories.list(req.user!.id));
  app.post("/api/v1/ai/memories", opts, async (req, reply) => {
    const body = z
      .object({ content: z.string().trim().min(1).max(300), kind: z.enum(["preference", "fact", "context"]).default("fact") })
      .parse(req.body);
    const created = await memories.add(req.user!.id, body.content, body.kind);
    if (!created) throw new HttpError(400, "MEMORY_LIMIT", "Limite de memórias atingido.");
    reply.status(201);
    return { id: created };
  });
  app.delete("/api/v1/ai/memories/:id", opts, async (req, reply) => {
    await memories.remove(req.user!.id, id(req.params));
    return reply.status(204).send();
  });
}
