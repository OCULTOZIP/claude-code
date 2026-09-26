import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmParams, LlmResult } from "../src/modules/ai/llm";

/**
 * Dublê de teste do LlmClient: devolve turnos roteirizados e registra as
 * requisições recebidas. Nunca é usado fora dos testes.
 */
export type ScriptedTurn = {
  /** Simula uma falha ao consumir o stream (ex.: JSON de tool ilegível, API fora). */
  throws?: Error;
  text?: string;
  tools?: { name: string; input: unknown }[];
  stop?: Anthropic.Beta.BetaStopReason;
};

export class ScriptedLlm implements LlmClient {
  readonly model = "scripted-test-model";
  readonly calls: LlmParams[] = [];
  private queue: ((params: LlmParams) => ScriptedTurn)[] = [];

  /** Enfileira turnos (objeto fixo ou função da requisição). */
  script(...turns: (ScriptedTurn | ((params: LlmParams) => ScriptedTurn))[]) {
    this.queue.push(...turns.map((t) => (typeof t === "function" ? t : () => t)));
    return this;
  }

  get pending() {
    return this.queue.length;
  }

  async stream(params: LlmParams, onText: (delta: string) => void): Promise<LlmResult> {
    // Cópia profunda: o orquestrador reconstrói as mensagens a cada iteração.
    this.calls.push(structuredClone(params));
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedLlm: nenhum turno roteirizado restante");
    const turn = next(params);
    if (turn.throws) throw turn.throws;
    const content: unknown[] = [];
    if (turn.text) {
      for (const piece of turn.text.match(/.{1,12}/gs) ?? []) onText(piece);
      content.push({ type: "text", text: turn.text, citations: null });
    }
    for (const [i, t] of (turn.tools ?? []).entries()) {
      content.push({ type: "tool_use", id: `toolu_test_${this.calls.length}_${i}`, name: t.name, input: t.input });
    }
    const message = {
      id: `msg_test_${this.calls.length}`,
      type: "message",
      role: "assistant",
      model: this.model,
      content,
      stop_reason: turn.stop ?? (turn.tools?.length ? "tool_use" : "end_turn"),
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Beta.BetaMessage;
    return { message, latencyMs: 1 };
  }
}

/** Último tool_result enviado ao modelo na requisição (JSON já parseado). */
export function lastToolResults(params: LlmParams) {
  const last = params.messages.at(-1);
  if (!last || typeof last.content === "string") return [];
  return last.content
    .filter((b) => b.type === "tool_result")
    .map((b) => {
      const r = b as Anthropic.Beta.BetaToolResultBlockParam;
      return { isError: Boolean(r.is_error), data: JSON.parse(String(r.content)) as Record<string, unknown> };
    });
}
