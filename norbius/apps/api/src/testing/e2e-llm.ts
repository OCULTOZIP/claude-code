import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient, LlmParams, LlmResult } from "../modules/ai/llm";

/**
 * SOMENTE para testes E2E (APP_ENV=test + AI_E2E_DOUBLE=1; a validação de
 * ambiente proíbe em qualquer outro ambiente). Regras fixas e previsíveis
 * que exercitam o caminho real: SSE, tools, cartões, confirmação e desfazer.
 * Não tenta imitar o modelo — responde só às frases dos testes.
 */
export class E2eLlm implements LlmClient {
  readonly model = "e2e-double";

  async stream(params: LlmParams, onText: (delta: string) => void): Promise<LlmResult> {
    const last = params.messages.at(-1)!;
    const blocks = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
    const toolResult = blocks.find((b) => b.type === "tool_result") as Anthropic.Beta.BetaToolResultBlockParam | undefined;
    const userText = blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").toLowerCase();

    let content: unknown[];
    if (toolResult) {
      const data = JSON.parse(String(toolResult.content)) as Record<string, unknown>;
      const text =
        data.status === "created"
          ? `Registrei ${data.amount} em ${data.category}.`
          : data.status === "awaiting_user_confirmation"
            ? "Confirme no cartão abaixo."
            : data.status === "needs_clarification"
              ? `Qual ${data.field}? ${(data.options as string[]).join(" ou ")}.`
              : data.available_balance
              ? `Seu saldo disponível é ${data.available_balance}.`
              : "Pronto.";
      content = [{ type: "text", text }];
    } else {
      const spent = /gastei (\d+(?:[.,]\d{1,2})?)/.exec(userText);
      const transfer = /transfere (\d+)/.exec(userText);
      if (spent) {
        content = [{ type: "tool_use", id: "toolu_e2e_1", name: "create_transaction", input: { type: "expense", amount: Number(spent[1]!.replace(",", ".")), description: "Mercado", category: "Alimentação", account: "Corrente" } }];
      } else if (transfer) {
        content = [{ type: "tool_use", id: "toolu_e2e_2", name: "create_transfer", input: { from_account: "Corrente", to_account: "Reserva", amount: Number(transfer[1]) } }];
      } else if (userText.includes("saldo")) {
        content = [{ type: "tool_use", id: "toolu_e2e_3", name: "get_financial_overview", input: {} }];
      } else {
        content = [{ type: "text", text: "Olá! Posso ajudar com seus gastos." }];
      }
    }
    for (const b of content) if ((b as { type: string }).type === "text") onText((b as { text: string }).text);
    const hasTool = content.some((b) => (b as { type: string }).type === "tool_use");
    return {
      latencyMs: 1,
      message: {
        id: "msg_e2e",
        type: "message",
        role: "assistant",
        model: this.model,
        content,
        stop_reason: hasTool ? "tool_use" : "end_turn",
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Beta.BetaMessage,
    };
  }
}
