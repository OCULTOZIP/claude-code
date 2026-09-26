import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../../env";

export type LlmParams = {
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
};

export type LlmResult = {
  message: Anthropic.Beta.BetaMessage;
  latencyMs: number;
};

/**
 * Fronteira com o modelo. A implementação real usa o SDK oficial; os testes
 * usam um dublê roteirizado. Nenhuma outra parte do código fala com a API.
 */
export interface LlmClient {
  readonly model: string;
  stream(params: LlmParams, onText: (delta: string) => void): Promise<LlmResult>;
}

/** Erro transitório/infra (limite, rede, indisponibilidade) — mensagem genérica ao usuário. */
export class LlmUnavailableError extends Error {}

export class AnthropicLlm implements LlmClient {
  private readonly client: Anthropic;
  readonly model: string;
  private readonly effort: Env["AI_EFFORT"];

  constructor(env: Env) {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
    this.model = env.AI_MODEL;
    this.effort = env.AI_EFFORT;
  }

  async stream(params: LlmParams, onText: (delta: string) => void): Promise<LlmResult> {
    const started = Date.now();
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 64000,
      // Recusas de segurança são reexecutadas no modelo recomendado pela
      // Anthropic para a categoria, dentro da mesma chamada.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...(this.effort ? { output_config: { effort: this.effort } } : {}),
      system: params.system,
      tools: params.tools,
      messages: params.messages,
    });
    stream.on("text", onText);
    try {
      const message = await stream.finalMessage();
      return { message, latencyMs: Date.now() - started };
    } catch (err) {
      if (
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError
      ) {
        throw new LlmUnavailableError(err.message);
      }
      throw err;
    }
  }
}
