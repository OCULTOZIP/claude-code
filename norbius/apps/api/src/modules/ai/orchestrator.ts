import Anthropic from "@anthropic-ai/sdk";
import { schema, withUserContext, type Database } from "@norbius/db";
import type { Logger } from "@norbius/observability";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Env } from "../../env";
import { userTimezone, userToday } from "../../lib/user-context";
import { HttpError, notFound } from "../../plugins/errors";
import { LlmUnavailableError, type LlmClient } from "./llm";
import { contextBlock, SYSTEM_PROMPT } from "./prompt";
import { TOOLS, TOOLS_BY_NAME } from "./tools";
import { planRequired } from "../billing/billing.service";
import type { ActionCard, Services, ToolContext, ToolDef } from "./tools/types";

const conv = schema.aiConversations;
const msg = schema.aiMessages;
const pending = schema.aiPendingActions;
const usage = schema.aiUsage;

/** Janela de histórico enviada ao modelo (em mensagens digitadas pelo usuário). */
const HISTORY_USER_TURNS = 20;
const PENDING_TTL_MS = 30 * 60 * 1000;
const MAX_JSON_RETRIES = 2;

export type ChatEvent =
  | { type: "conversation"; id: string; title: string | null }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "card"; card: ActionCard }
  | { type: "notice"; message: string }
  | { type: "done" };

/** Definições de tools para a API (JSON Schema gerado do mesmo Zod que valida). */
export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return TOOLS.map((t) => {
    const { $schema: _s, ...inputSchema } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
    return {
      name: t.name,
      description: t.description,
      input_schema: inputSchema as Anthropic.Beta.BetaTool["input_schema"],
      // Streaming: entrada chega sem buffer; validamos com Zod antes de executar.
      eager_input_streaming: true,
    };
  });
}

const MONEY_RE = /R\$\s?-?\d{1,3}(?:\.\d{3})*,\d{2}|-R\$\s?\d{1,3}(?:\.\d{3})*,\d{2}/g;
const normMoney = (s: string) => s.replace(/\s/g, "").replace("-R$", "R$-");

/**
 * Valores em reais citados na resposta que não aparecem em nenhum dado desta
 * rodada (contexto ou resultado de tool). Sinal de possível alucinação.
 */
export function unverifiedAmounts(answer: string, evidence: string[]): string[] {
  const known = new Set(evidence.flatMap((e) => (e.match(MONEY_RE) ?? []).map(normMoney)));
  return [...new Set((answer.match(MONEY_RE) ?? []).map(normMoney))].filter((v) => !known.has(v));
}

export class AiOrchestrator {
  private readonly tools = toolDefinitions();

  constructor(
    private readonly db: Database,
    private readonly llm: LlmClient | null,
    private readonly services: Services,
    private readonly env: Env,
    private readonly log: Logger,
  ) {}

  entitlements(userId: string) {
    return this.services.billing.entitlements(userId);
  }

  get available() {
    return this.llm !== null;
  }

  // ── Conversas ─────────────────────────────────────────────
  listConversations(userId: string) {
    return withUserContext(this.db, userId, (tx) =>
      tx
        .select({ id: conv.id, title: conv.title, lastMessageAt: conv.lastMessageAt })
        .from(conv)
        .where(sql`${conv.archivedAt} is null`)
        .orderBy(desc(conv.lastMessageAt))
        .limit(50),
    );
  }

  /** Histórico para a UI: textos do usuário, respostas e cartões (sem blocos internos). */
  async conversation(userId: string, id: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const [c] = await tx.select().from(conv).where(eq(conv.id, id));
      if (!c) throw notFound("Conversa");
      const rows = await tx.select().from(msg).where(eq(msg.conversationId, id)).orderBy(asc(msg.createdAt));
      const actions = await tx.select().from(pending).where(eq(pending.conversationId, id));
      const status = new Map(actions.map((a) => [a.id, a.status]));
      type Item = { role: "user" | "assistant"; text: string; cards: (ActionCard & { status?: string })[] };
      const items = rows.flatMap((r): Item[] => {
        const blocks = r.content as { type: string; text?: string }[];
        const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
        const cards = ((r.cards as ActionCard[] | null) ?? []).map((card) =>
          card.actionId ? { ...card, status: status.get(card.actionId) ?? "pending" } : card,
        );
        if (r.kind === "user_text") return [{ role: "user", text, cards: [] }];
        if (r.kind === "assistant" && (text || cards.length)) return [{ role: "assistant", text, cards }];
        if (r.kind === "tool_results" && cards.length) return [{ role: "assistant", text: "", cards }];
        return [];
      });
      // Uma resposta pode ocupar vários registros (tool_use → resultados → texto):
      // junta itens consecutivos do NORBIUS num só, como aparecem ao vivo.
      const merged: Item[] = [];
      for (const it of items) {
        const prev = merged.at(-1);
        if (prev && prev.role === "assistant" && it.role === "assistant") {
          prev.cards.push(...it.cards);
          prev.text = [prev.text, it.text].filter(Boolean).join("\n\n");
        } else merged.push({ ...it, cards: [...it.cards] });
      }
      return { id: c.id, title: c.title, items: merged };
    });
  }

  archiveConversation(userId: string, id: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx.update(conv).set({ archivedAt: new Date() }).where(eq(conv.id, id)).returning({ id: conv.id });
      if (!row) throw notFound("Conversa");
    });
  }

  async usage(userId: string) {
    return withUserContext(this.db, userId, async (tx) => {
      const month = `${(await userToday(tx)).slice(0, 7)}-01`;
      const [row] = await tx.select().from(usage).where(eq(usage.periodMonth, month));
      return { used: row?.messagesCount ?? 0, limit: this.env.AI_MONTHLY_MESSAGE_LIMIT };
    });
  }

  // ── Chat ──────────────────────────────────────────────────
  async chat(userId: string, input: { conversationId?: string | undefined; message: string }, requestId: string, emit: (e: ChatEvent) => void) {
    if (!this.llm) throw new HttpError(503, "AI_UNAVAILABLE", "O assistente NORBIUS não está configurado neste ambiente.");
    const llm = this.llm;

    // Cota + conversa + mensagem do usuário, numa transação.
    const { conversationId, month } = await withUserContext(this.db, userId, async (tx) => {
      if (!(await this.services.billing.entitlementsInTx(tx)).assistant) throw planRequired();
      const month = `${(await userToday(tx)).slice(0, 7)}-01`;
      const [u] = await tx.select().from(usage).where(eq(usage.periodMonth, month));
      if ((u?.messagesCount ?? 0) >= this.env.AI_MONTHLY_MESSAGE_LIMIT) {
        throw new HttpError(429, "AI_QUOTA_EXCEEDED", "Você atingiu o limite de mensagens com o NORBIUS neste mês.");
      }
      let id = input.conversationId;
      if (id) {
        const [c] = await tx.select({ id: conv.id }).from(conv).where(eq(conv.id, id));
        if (!c) throw notFound("Conversa");
      } else {
        const title = input.message.replace(/\s+/g, " ").trim().slice(0, 60);
        const [c] = await tx.insert(conv).values({ userId, title }).returning({ id: conv.id });
        id = c!.id;
        emit({ type: "conversation", id, title });
      }
      await tx.insert(msg).values({ userId, conversationId: id, role: "user", kind: "user_text", content: [{ type: "text", text: input.message }] });
      await tx
        .insert(usage)
        .values({ userId, periodMonth: month, messagesCount: 1 })
        .onConflictDoUpdate({ target: [usage.userId, usage.periodMonth], set: { messagesCount: sql`${usage.messagesCount} + 1` } });
      return { conversationId: id, month };
    });

    const ctx: ToolContext = { userId, requestId, conversationId, today: "", services: this.services };
    const context = await this.buildContext(userId, conversationId);
    ctx.today = context.today;
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      contextBlock(context),
    ];
    const evidence: string[] = [system[1]!.text];
    let finalText = "";
    let tokensIn = 0;
    let tokensOut = 0;

    for (let iteration = 0, jsonRetries = 0; iteration < this.env.AI_MAX_TOOL_ITERATIONS; ) {
      const messages = await this.history(userId, conversationId);
      let result;
      try {
        result = await llm.stream({ system, messages, tools: this.tools }, (delta) => emit({ type: "text", delta }));
        jsonRetries = 0;
      } catch (err) {
        if (err instanceof LlmUnavailableError) {
          this.log.warn({ err: err.message }, "LLM indisponível");
          emit({ type: "notice", message: "O NORBIUS está temporariamente indisponível. Tente novamente em instantes." });
          break;
        }
        // Com eager streaming, JSON de tool impossível de parsear rejeita o stream: reemite o turno.
        if (isApiError(err) || jsonRetries++ >= MAX_JSON_RETRIES) throw err;
        this.log.warn({ err: String(err) }, "entrada de tool ilegível; reemitindo o turno");
        continue;
      }
      iteration++;
      const { message, latencyMs } = result;
      tokensIn += message.usage.input_tokens;
      tokensOut += message.usage.output_tokens;
      await this.persist(userId, conversationId, "assistant", message.content, null, {
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? null,
        latencyMs,
        stopReason: message.stop_reason,
      });
      finalText += message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");

      if (message.stop_reason === "refusal") {
        emit({ type: "notice", message: "Não posso ajudar com esse pedido." });
        break;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) break;
      if (message.stop_reason === "max_tokens") {
        // Entrada de tool truncada pode parecer válida: nunca executar.
        emit({ type: "notice", message: "A resposta ficou longa demais. Tente reformular em partes menores." });
        break;
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      const cards: ActionCard[] = [];
      for (const use of toolUses) {
        emit({ type: "tool", name: use.name });
        const { content, card, isError } = await this.runTool(ctx, use);
        results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
        evidence.push(content);
        if (card) {
          cards.push(card);
          emit({ type: "card", card });
        }
      }
      // Todos os resultados numa única mensagem (preserva chamadas paralelas).
      await this.persist(userId, conversationId, "tool_results", results, cards.length ? cards : null);
      if (iteration >= this.env.AI_MAX_TOOL_ITERATIONS) {
        emit({ type: "notice", message: "Não consegui concluir dentro do limite de etapas. Tente uma pergunta mais específica." });
      }
    }

    const unverified = unverifiedAmounts(finalText, evidence);
    if (unverified.length) {
      // Não loga os valores (dados financeiros), só a contagem.
      this.log.warn({ conversationId, count: unverified.length }, "ai.unverified_number");
    }

    await withUserContext(this.db, userId, async (tx) => {
      await tx.update(conv).set({ lastMessageAt: new Date() }).where(eq(conv.id, conversationId));
      await tx
        .update(usage)
        .set({ inputTokens: sql`${usage.inputTokens} + ${tokensIn}`, outputTokens: sql`${usage.outputTokens} + ${tokensOut}` })
        .where(eq(usage.periodMonth, month));
    });
    emit({ type: "done" });
    return { conversationId, unverifiedAmounts: unverified.length };
  }

  private async runTool(ctx: ToolContext, use: Anthropic.Beta.BetaToolUseBlock): Promise<{ content: string; card?: ActionCard; isError?: boolean }> {
    const tool = TOOLS_BY_NAME.get(use.name);
    if (!tool) return { content: JSON.stringify({ error: `Ferramenta desconhecida: ${use.name}` }), isError: true };
    // O parser tolerante do SDK pode entregar entrada truncada: sempre validar.
    const parsed = tool.schema.safeParse(use.input);
    if (!parsed.success) {
      return {
        content: JSON.stringify({ INVALID_INPUT: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }),
        isError: true,
      };
    }
    try {
      if (tool.mode === "confirm") return await this.propose(ctx, tool, parsed.data);
      const run = await tool.run(ctx, parsed.data);
      return { content: JSON.stringify(run.result), card: run.card };
    } catch (err) {
      this.log.error({ err, tool: use.name }, "falha ao executar tool");
      return { content: JSON.stringify({ error: "Falha interna ao executar a ferramenta." }), isError: true };
    }
  }

  /** Ações sensíveis viram pendentes: nada muda até o usuário confirmar. */
  private async propose(ctx: ToolContext, tool: ToolDef, input: unknown) {
    const preview = await tool.preview!(ctx, input);
    if ("result" in preview) return { content: JSON.stringify(preview.result) };
    const id = await withUserContext(this.db, ctx.userId, async (tx) => {
      const [row] = await tx
        .insert(pending)
        .values({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          toolName: tool.name,
          payload: input as object,
          preview,
          expiresAt: new Date(Date.now() + PENDING_TTL_MS),
        })
        .returning({ id: pending.id });
      return row!.id;
    });
    return {
      content: JSON.stringify({ status: "awaiting_user_confirmation", action_id: id, summary: preview.lines }),
      card: { kind: "pending" as const, title: preview.title, lines: preview.lines, actionId: id },
    };
  }

  /** Execução após clique do usuário: roda exatamente o payload validado que ele viu. */
  async confirm(userId: string, actionId: string, requestId: string) {
    const action = await withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(pending)
        .set({ status: "executed", resolvedAt: new Date() })
        .where(and(eq(pending.id, actionId), eq(pending.status, "pending"), sql`${pending.expiresAt} > now()`))
        .returning();
      if (row) return row;
      const [existing] = await tx.select().from(pending).where(eq(pending.id, actionId));
      if (!existing) throw notFound("Ação");
      throw new HttpError(409, "ACTION_NOT_PENDING", existing.status === "pending" ? "Esta ação expirou. Peça novamente ao NORBIUS." : "Esta ação já foi resolvida.");
    });
    const tool = TOOLS_BY_NAME.get(action.toolName)!;
    const parsed = tool.schema.parse(action.payload);
    const today = await withUserContext(this.db, userId, (tx) => userToday(tx));
    const ctx: ToolContext = { userId, requestId, conversationId: action.conversationId, today, services: this.services };
    const run = await tool.run(ctx, parsed);
    const failed = (run.result as { status?: string }).status === "error";
    await withUserContext(this.db, userId, (tx) =>
      tx.update(pending).set({ status: failed ? "failed" : "executed", result: run.result as object }).where(eq(pending.id, actionId)),
    );
    await this.services.audit.record({ actorType: "user", actorId: userId, subjectUserId: userId, action: "ai.action.confirm", entityType: "ai_action", entityId: actionId, metadata: { tool: action.toolName }, requestId });
    if (failed) throw new HttpError(400, "ACTION_FAILED", (run.result as { message?: string }).message ?? "Não foi possível executar a ação.");
    return { status: "executed" as const, card: run.card ?? null };
  }

  async reject(userId: string, actionId: string) {
    await withUserContext(this.db, userId, async (tx) => {
      const [row] = await tx
        .update(pending)
        .set({ status: "rejected", resolvedAt: new Date() })
        .where(and(eq(pending.id, actionId), eq(pending.status, "pending")))
        .returning({ id: pending.id });
      if (!row) throw notFound("Ação pendente");
    });
    return { status: "rejected" as const };
  }

  // ── Contexto e histórico ──────────────────────────────────
  private async buildContext(userId: string, conversationId: string) {
    const [accounts, cards, categories, memories, me] = await Promise.all([
      this.services.accounts.list(userId),
      this.services.cards.list(userId),
      this.services.categories.list(userId),
      this.services.memories.list(userId),
      withUserContext(this.db, userId, async (tx) => {
        const [p] = await tx.select({ name: schema.profiles.displayName }).from(schema.profiles);
        return { name: p?.name ?? "usuário", today: await userToday(tx), tz: await userTimezone(tx) };
      }),
    ]);
    const actions = await withUserContext(this.db, userId, (tx) =>
      tx.select().from(pending).where(eq(pending.conversationId, conversationId)).orderBy(desc(pending.createdAt)).limit(10),
    );
    const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
    return {
      today: me.today,
      timezone: me.tz,
      displayName: me.name,
      accounts: accounts.filter((a) => !a.archived).map((a) => ({ name: a.name, type: a.type, balance: fmt.format(a.balanceCents / 100).replace(/ /g, " ") })),
      cards: cards.filter((c) => !c.archived).map((c) => ({ name: c.name })),
      expenseCategories: categories.filter((c) => c.kind === "expense").map((c) => c.name),
      incomeCategories: categories.filter((c) => c.kind === "income").map((c) => c.name),
      memories: memories.map((m) => ({ content: m.content })),
      recentActions: actions.map((a) => ({
        tool: a.toolName,
        status: a.status === "pending" && a.expiresAt < new Date() ? "expired" : a.status,
        summary: ((a.preview as { lines?: string[] }).lines ?? []).join(" | "),
      })),
    };
  }

  /**
   * Histórico reenviado exatamente como armazenado (sem editar turnos
   * anteriores), limitado às últimas N mensagens do usuário. O corte sempre
   * começa numa mensagem digitada, nunca no meio de um par tool_use/tool_result.
   */
  private async history(userId: string, conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
    const rows = await withUserContext(this.db, userId, (tx) =>
      tx.select({ role: msg.role, kind: msg.kind, content: msg.content }).from(msg).where(eq(msg.conversationId, conversationId)).orderBy(asc(msg.createdAt)),
    );
    const userTurns = rows.map((r, i) => (r.kind === "user_text" ? i : -1)).filter((i) => i >= 0);
    const start = userTurns.length > HISTORY_USER_TURNS ? userTurns[userTurns.length - HISTORY_USER_TURNS]! : 0;
    return rows.slice(start).map((r) => ({ role: r.role, content: r.content as Anthropic.Beta.BetaMessageParam["content"] }));
  }

  private persist(
    userId: string,
    conversationId: string,
    kind: "assistant" | "tool_results",
    content: unknown,
    cards: ActionCard[] | null,
    meta: Partial<typeof msg.$inferInsert> = {},
  ) {
    return withUserContext(this.db, userId, (tx) =>
      tx.insert(msg).values({
        userId,
        conversationId,
        role: kind === "assistant" ? "assistant" : "user",
        kind,
        content: content as object,
        cards,
        ...meta,
      }),
    );
  }
}

function isApiError(err: unknown) {
  return err instanceof Anthropic.APIError;
}
