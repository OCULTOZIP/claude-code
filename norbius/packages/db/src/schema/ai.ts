import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// NORBIUS AI. Conversas guardam os blocos de conteúdo exatamente como a API
// os devolveu (necessário para reenviar o histórico sem editá-lo).
const currentUser = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const ownRows = sql`user_id = ${currentUser}`;
const owner = (table: string) =>
  pgPolicy(`${table}_owner`, { for: "all", to: "norbius_app", using: ownRows, withCheck: ownRows });
const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    title: text("title"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_conversations_user_id_id_unique").on(t.userId, t.id),
    index("ai_conversations_user_last_idx").on(t.userId, t.lastMessageAt.desc()),
    check("ai_conversations_title_check", sql`${t.title} is null or char_length(${t.title}) <= 120`),
    owner("ai_conversations"),
  ],
).enableRLS();

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    conversationId: uuid("conversation_id").notNull(),
    /** Papel na API de mensagens. Resultados de tools são turnos "user". */
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    /** user_text: mensagem digitada; assistant: resposta; tool_results: retorno das tools. */
    kind: text("kind", { enum: ["user_text", "assistant", "tool_results"] }).notNull(),
    /** Blocos de conteúdo no formato da API (texto, tool_use, tool_result, thinking...). */
    content: jsonb("content").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    latencyMs: integer("latency_ms"),
    stopReason: text("stop_reason"),
    /** Cartões de ação exibidos na UI (reconstrução do histórico). */
    cards: jsonb("cards"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt),
    foreignKey({
      name: "ai_messages_conversation_fk",
      columns: [t.userId, t.conversationId],
      foreignColumns: [aiConversations.userId, aiConversations.id],
    }).onDelete("cascade"),
    check("ai_messages_role_check", sql`${t.role} in ('user','assistant')`),
    check(
      "ai_messages_kind_check",
      sql`(${t.kind} = 'assistant') = (${t.role} = 'assistant') and ${t.kind} in ('user_text','assistant','tool_results')`,
    ),
    owner("ai_messages"),
  ],
).enableRLS();

/** Ações propostas pela IA que exigem confirmação explícita do usuário. */
export const aiPendingActions = pgTable(
  "ai_pending_actions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    conversationId: uuid("conversation_id").notNull(),
    toolName: text("tool_name").notNull(),
    /** Entrada já validada; é exatamente isto que será executado. */
    payload: jsonb("payload").notNull(),
    /** O que o usuário vê no cartão de confirmação. */
    preview: jsonb("preview").notNull(),
    status: text("status", { enum: ["pending", "executed", "rejected", "expired", "failed"] })
      .notNull()
      .default("pending"),
    result: jsonb("result"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_pending_actions_conversation_idx").on(t.userId, t.conversationId),
    foreignKey({
      name: "ai_pending_actions_conversation_fk",
      columns: [t.userId, t.conversationId],
      foreignColumns: [aiConversations.userId, aiConversations.id],
    }).onDelete("cascade"),
    check("ai_pending_actions_status_check", sql`${t.status} in ('pending','executed','rejected','expired','failed')`),
    owner("ai_pending_actions"),
  ],
).enableRLS();

/** Memória de longo prazo: visível, editável e apagável pelo usuário. */
export const aiMemories = pgTable(
  "ai_memories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: userId(),
    content: text("content").notNull(),
    kind: text("kind", { enum: ["preference", "fact", "context"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_memories_user_idx").on(t.userId),
    check("ai_memories_content_check", sql`char_length(${t.content}) between 1 and 300`),
    check("ai_memories_kind_check", sql`${t.kind} in ('preference','fact','context')`),
    owner("ai_memories"),
  ],
).enableRLS();

/** Consumo mensal (limites de uso e custo). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    userId: userId(),
    periodMonth: date("period_month").notNull(),
    messagesCount: integer("messages_count").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.periodMonth] }), owner("ai_usage")],
).enableRLS();
