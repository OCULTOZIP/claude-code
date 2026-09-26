import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../plugins/errors";
import type { RequireUser } from "../../plugins/session";

const ttsBody = z.object({
  text: z.string().trim().min(1).max(4000),
  voice: z
    .string()
    .regex(/^[a-z]+$/)
    .max(40)
    .optional(),
  speed: z.number().min(0.5).max(2).optional(),
});

/**
 * Voz neural local (Piper), servida por um processo à parte em `ttsUrl`.
 * Sem `TTS_URL`, `/voices` responde vazio e o web usa a voz do navegador.
 */
export function registerVoiceRoutes(app: FastifyInstance, requireUser: RequireUser, ttsUrl: string | undefined) {
  const opts = { preHandler: requireUser };

  app.get("/api/v1/ai/voices", opts, async () => {
    if (!ttsUrl) return { voices: [] };
    try {
      const res = await fetch(`${ttsUrl}/voices`, { signal: AbortSignal.timeout(2000) });
      return { voices: res.ok ? ((await res.json()) as string[]) : [] };
    } catch {
      return { voices: [] };
    }
  });

  app.post("/api/v1/ai/tts", { ...opts, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!ttsUrl) throw new HttpError(503, "TTS_UNAVAILABLE", "A voz neural não está configurada.");
    const body = ttsBody.parse(req.body);
    let res: Response;
    try {
      res = await fetch(`${ttsUrl}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new HttpError(503, "TTS_UNAVAILABLE", "O serviço de voz não está respondendo.");
    }
    if (!res.ok) throw new HttpError(502, "TTS_FAILED", "Não foi possível gerar a voz agora.");
    return reply
      .header("content-type", "audio/wav")
      .header("cache-control", "no-store")
      .send(Buffer.from(await res.arrayBuffer()));
  });
}
