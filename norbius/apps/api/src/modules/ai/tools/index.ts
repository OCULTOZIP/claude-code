import { withUserContext } from "@norbius/db";
import {
  addMonthsToMonth,
  compareDates,
  diffDays,
  formatBRL,
  isIsoDate,
  monthOf,
  monthRange,
} from "@norbius/domain";
import { z } from "zod";
import { HttpError } from "../../../plugins/errors";
import { resolveByName, type Resolution } from "./resolve";
import { defineTool, type ToolContext, type ToolDef, type ToolRun } from "./types";

// ── Entradas ────────────────────────────────────────────────
// Valores chegam em reais (número decimal) e viram centavos aqui, no código:
// o modelo nunca faz aritmética de centavos.
const amountBrl = z
  .number()
  .positive("O valor precisa ser positivo.")
  .max(1_000_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Use no máximo 2 casas decimais.");
const toCents = (v: number) => Math.round(v * 100);
const isoDate = z.string().refine(isIsoDate, "Data inválida (use AAAA-MM-DD).");
const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido (use AAAA-MM).");
const shortText = (max: number) => z.string().trim().min(1).max(max);

/** Datas absurdas (muito longe de hoje) exigem que o modelo reconfirme com o usuário. */
function checkDate(ctx: ToolContext, date: string | undefined) {
  const d = date ?? ctx.today;
  if (Math.abs(diffDays(d, ctx.today)) > 366) {
    return { error: "date_out_of_range", message: `A data ${d} está a mais de um ano de hoje (${ctx.today}). Confirme a data com o usuário.` };
  }
  return d;
}

function clarification(what: string, r: Exclude<Resolution<unknown>, { ok: true }>) {
  return {
    result: {
      status: "needs_clarification",
      field: what,
      reason: r.reason,
      options: r.options,
      instruction:
        r.reason === "ambiguous"
          ? `Pergunte ao usuário qual ${what} ele quis dizer, entre as opções.`
          : `Nenhum(a) ${what} corresponde. Mostre as opções ao usuário e pergunte.`,
    },
  } satisfies ToolRun;
}

async function accountsOf(ctx: ToolContext) {
  return (await ctx.services.accounts.list(ctx.userId)).filter((a) => !a.archived);
}

async function categoryFor(ctx: ToolContext, name: string, kind: "income" | "expense") {
  const all = (await ctx.services.categories.list(ctx.userId)).filter((c) => c.kind === kind);
  return resolveByName(all, name);
}

const brl = (cents: number) => formatBRL(cents);

/** Erros de negócio da API viram resultado de erro para o modelo explicar ao usuário. */
async function guard<T>(fn: () => Promise<T>): Promise<T | ToolRun> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return { result: { status: "error", code: err.code, message: err.message } };
    throw err;
  }
}

// ── Leitura ─────────────────────────────────────────────────
const getFinancialOverview = defineTool({
  name: "get_financial_overview",
  description:
    "Visão geral do mês atual: saldo disponível, receitas e despesas do mês (reais), investimentos, contas com saldo, cartões e metas. Use para perguntas gerais como 'como está minha situação financeira?'.",
  schema: z.object({}),
  mode: "read",
  run: async (ctx) => {
    const s = await ctx.services.dashboard.summary(ctx.userId);
    return {
      result: {
        kind: "actual",
        as_of: s.today,
        month: s.month,
        available_balance: brl(s.availableBalance.cents),
        month_income: brl(s.monthIncome.cents),
        month_expense: brl(s.monthExpense.cents),
        investments: brl(s.investments.cents),
        accounts: s.accounts.map((a) => ({ name: a.name, balance: brl(a.balanceCents) })),
        cards: s.cards.map((c) => ({ name: c.name, used: brl(c.usedLimitCents), limit: brl(c.limitCents) })),
        goals: s.goals.map((g) => ({ name: g.name, progress_pct: Math.round(g.progress * 100), current: brl(g.currentAmountCents), target: brl(g.targetAmountCents) })),
        history_days: s.core.historyDays,
      },
    };
  },
});

const searchTransactions = defineTool({
  name: "search_transactions",
  description:
    "Busca movimentações de conta (receitas, despesas, transferências) com filtros. Não inclui compras no cartão (use get_spending_by_category ou get_credit_cards para isso). Retorna itens e totais.",
  schema: z.object({
    month: isoMonth.optional().describe("Mês AAAA-MM. Padrão: mês atual se nenhum intervalo for dado."),
    from: isoDate.optional(),
    to: isoDate.optional(),
    type: z.enum(["income", "expense", "transfer"]).optional(),
    query: z.string().trim().max(80).optional().describe("Texto na descrição, ex.: 'uber'"),
    category: z.string().trim().max(40).optional(),
    account: z.string().trim().max(60).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  mode: "read",
  run: (ctx, input) =>
    guard(async () => {
      let categoryId: string | undefined;
      if (input.category) {
        const all = await ctx.services.categories.list(ctx.userId);
        const r = resolveByName(all, input.category);
        if (!r.ok) return clarification("categoria", r);
        categoryId = r.item.id;
      }
      let accountId: string | undefined;
      if (input.account) {
        const r = resolveByName(await accountsOf(ctx), input.account);
        if (!r.ok) return clarification("conta", r);
        accountId = r.item.id;
      }
      const month = input.month ?? (input.from || input.to ? undefined : monthOf(ctx.today));
      const list = await ctx.services.transactions.list(ctx.userId, {
        month,
        from: input.from,
        to: input.to,
        type: input.type,
        q: input.query,
        categoryId,
        accountId,
        sort: "date_desc",
        page: 1,
        pageSize: input.limit,
      });
      return {
        result: {
          kind: "actual",
          period: month ?? `${input.from ?? "início"} a ${input.to ?? "hoje"}`,
          total_found: list.total,
          total_income: brl(list.totals.incomeCents),
          total_expense: brl(list.totals.expenseCents),
          items: list.items.map((t) => ({
            id: t.id,
            date: t.date,
            type: t.type,
            description: t.description,
            amount: brl(t.amountCents),
            category: t.category?.name ?? null,
            account: t.account.name,
            to_account: t.transferAccount?.name ?? null,
          })),
          truncated: list.total > list.items.length,
        },
      };
    }),
});

const getSpendingByCategory = defineTool({
  name: "get_spending_by_category",
  description:
    "Despesas por categoria num mês (inclui parcelas de cartão pela competência). Use para 'quanto gastei com X' ou 'onde estou gastando mais'.",
  schema: z.object({
    month: isoMonth.optional().describe("AAAA-MM. Padrão: mês atual (até hoje)."),
    category: z.string().trim().max(40).optional(),
  }),
  mode: "read",
  run: (ctx, input) =>
    guard(async () => {
      const month = input.month ?? monthOf(ctx.today);
      const { start, end } = monthRange(month);
      const until = compareDates(end, ctx.today) > 0 ? ctx.today : end;
      const rows = await withUserContext(ctx.services.dashboard.db, ctx.userId, (tx) =>
        ctx.services.dashboard.categoryBreakdown(tx, start, until),
      );
      const total = rows.reduce((s, r) => s + r.cents, 0);
      if (input.category) {
        const r = resolveByName(rows, input.category);
        const found = r.ok ? r.item : null;
        return {
          result: {
            kind: "actual",
            month,
            period: `${start} a ${until}`,
            category: input.category,
            spent: brl(found?.cents ?? 0),
            note: found ? undefined : "Nenhuma despesa nessa categoria no período.",
            total_expense: brl(total),
          },
        };
      }
      return {
        result: {
          kind: "actual",
          month,
          period: `${start} a ${until}`,
          total_expense: brl(total),
          categories: rows.map((r) => ({ name: r.name, spent: brl(r.cents), share_pct: Math.round(r.share * 100) })),
        },
      };
    }),
});

const comparePeriods = defineTool({
  name: "compare_periods",
  description:
    "Compara despesas e receitas entre dois meses. Para o mês atual, compara até o mesmo dia do mês anterior (comparação justa). Use para 'estou gastando mais que no mês passado?'.",
  schema: z.object({
    month_a: isoMonth.optional().describe("Mês mais recente. Padrão: mês atual."),
    month_b: isoMonth.optional().describe("Mês de comparação. Padrão: mês anterior a month_a."),
  }),
  mode: "read",
  run: (ctx, input) =>
    guard(async () => {
      const a = input.month_a ?? monthOf(ctx.today);
      const b = input.month_b ?? addMonthsToMonth(a, -1);
      const current = a === monthOf(ctx.today);
      const day = Number(ctx.today.slice(8, 10));
      const rangeOf = (m: string) => {
        const { start, end } = monthRange(m);
        if (!current) return { start, end };
        const cut = `${m}-${String(Math.min(day, Number(end.slice(8, 10)))).padStart(2, "0")}`;
        return { start, end: cut };
      };
      const ra = rangeOf(a);
      const rb = rangeOf(b);
      const [ca, cb] = await withUserContext(ctx.services.dashboard.db, ctx.userId, async (tx) => [
        await ctx.services.dashboard.categoryBreakdown(tx, ra.start, ra.end),
        await ctx.services.dashboard.categoryBreakdown(tx, rb.start, rb.end),
      ]);
      const [ia, ib] = await Promise.all(
        [ra, rb].map((r) =>
          ctx.services.transactions.list(ctx.userId, { from: r.start, to: r.end, type: "income", sort: "date_desc", page: 1, pageSize: 1 }),
        ),
      );
      const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);
      const names = [...new Set([...ca.map((c) => c.name), ...cb.map((c) => c.name)])];
      return {
        result: {
          kind: "actual",
          comparison: current ? `${ra.start}..${ra.end} vs ${rb.start}..${rb.end} (mesmo dia do mês)` : `${a} vs ${b}`,
          expense_a: brl(sum(ca)),
          expense_b: brl(sum(cb)),
          expense_diff: brl(sum(ca) - sum(cb)),
          income_a: brl(ia!.totals.incomeCents),
          income_b: brl(ib!.totals.incomeCents),
          by_category: names.map((n) => {
            const x = ca.find((c) => c.name === n)?.cents ?? 0;
            const y = cb.find((c) => c.name === n)?.cents ?? 0;
            return { category: n, a: brl(x), b: brl(y), diff: brl(x - y) };
          }),
        },
      };
    }),
});

const listUpcomingBills = defineTool({
  name: "list_upcoming_bills",
  description:
    "Compromissos futuros: contas fixas e receitas previstas pendentes, faturas de cartão em aberto e lançamentos com data futura. Itens com estimate=true são valores estimados.",
  schema: z.object({ days: z.number().int().min(1).max(90).default(30) }),
  mode: "read",
  run: async (ctx, input) => {
    const items = await withUserContext(ctx.services.dashboard.db, ctx.userId, (tx) =>
      ctx.services.dashboard.commitments(tx, ctx.today, input.days, 40),
    );
    return {
      result: {
        as_of: ctx.today,
        window_days: input.days,
        items: items.map((c) => ({
          date: c.date,
          description: c.description,
          amount: brl(c.amountCents),
          direction: c.direction === "in" ? "entrada" : "saída",
          estimate: c.isEstimate,
          overdue: c.overdue,
        })),
      },
    };
  },
});

const getCreditCards = defineTool({
  name: "get_credit_cards",
  description: "Cartões de crédito: limite, limite usado (inclui parcelas futuras), disponível, fechamento, vencimento e fatura atual.",
  schema: z.object({}),
  mode: "read",
  run: async (ctx) => {
    const cards = (await ctx.services.cards.list(ctx.userId)).filter((c) => !c.archived);
    return {
      result: {
        kind: "actual",
        cards: cards.map((c) => ({
          name: c.name,
          limit: brl(c.limitCents),
          used: brl(c.usedLimitCents),
          available: brl(c.availableLimitCents),
          closing_day: c.closingDay,
          due_day: c.dueDay,
          current_invoice: c.currentInvoice
            ? {
                month: c.currentInvoice.referenceMonth,
                total: brl(c.currentInvoice.totalCents),
                paid: brl(c.currentInvoice.paidCents),
                status: c.currentInvoice.status,
                closing_date: c.currentInvoice.closingDate,
                due_date: c.currentInvoice.dueDate,
              }
            : null,
        })),
      },
    };
  },
});

const getGoals = defineTool({
  name: "get_goals",
  description: "Metas: valor alvo, valor atual (soma dos aportes), progresso, prazo e aporte mensal estimado para chegar no prazo.",
  schema: z.object({}),
  mode: "read",
  run: async (ctx) => {
    const goals = await ctx.services.goals.list(ctx.userId);
    return {
      result: {
        goals: goals.map((g) => ({
          name: g.name,
          status: g.status,
          target: brl(g.targetAmountCents),
          current: brl(g.currentAmountCents),
          progress_pct: Math.round(g.progress * 100),
          target_date: g.targetDate,
          monthly_needed_estimate: g.monthlyNeededCents ? brl(g.monthlyNeededCents) : null,
        })),
      },
    };
  },
});

// ── Registro (executa e oferece desfazer) ───────────────────
const createTransaction = defineTool({
  name: "create_transaction",
  description:
    "Registra uma receita ou despesa em uma conta. Use quando o usuário disser explicitamente que gastou/pagou/recebeu um valor. Categoria deve ser um nome da lista de categorias do contexto. Se o usuário não disser a conta e houver mais de uma, a tool pedirá esclarecimento.",
  schema: z.object({
    type: z.enum(["income", "expense"]),
    amount: amountBrl.describe("Valor em reais, ex.: 50 ou 1234.56"),
    description: shortText(140).describe("Descrição curta, ex.: 'Mercado'"),
    category: shortText(40),
    account: z.string().trim().max(60).optional(),
    date: isoDate.optional().describe("AAAA-MM-DD. Padrão: hoje."),
    payment_method: z.enum(["pix", "debit", "cash", "boleto", "transfer", "other"]).optional(),
  }),
  mode: "write",
  run: (ctx, input) =>
    guard(async () => {
      const date = checkDate(ctx, input.date);
      if (typeof date !== "string") return { result: date };
      const acc = resolveByName(await accountsOf(ctx), input.account);
      if (!acc.ok) return clarification("conta", acc);
      const cat = await categoryFor(ctx, input.category, input.type);
      if (!cat.ok) return clarification("categoria", cat);
      const t = await ctx.services.transactions.create(
        ctx.userId,
        {
          type: input.type,
          accountId: acc.item.id,
          amountCents: toCents(input.amount),
          categoryId: cat.item.id,
          description: input.description,
          date,
          paymentMethod: input.payment_method ?? null,
          notes: null,
        },
        ctx.requestId,
        "ai",
      );
      return {
        result: { status: "created", id: t.id, type: t.type, amount: brl(t.amountCents), description: t.description, category: t.category?.name, account: t.account.name, date: t.date },
        card: {
          kind: "created",
          title: `${t.type === "income" ? "Receita" : "Despesa"} registrada`,
          lines: [`${t.description} · ${brl(t.amountCents)}`, `${t.category?.name} · ${t.account.name} · ${t.date.split("-").reverse().join("/")}`],
          undo: { method: "DELETE", path: `/api/v1/transactions/${t.id}` },
        },
      };
    }),
});

const createCardPurchase = defineTool({
  name: "create_card_purchase",
  description: "Registra uma compra no cartão de crédito, opcionalmente parcelada. Use quando o usuário disser que comprou/pagou no cartão.",
  schema: z.object({
    card: z.string().trim().max(60).optional().describe("Nome do cartão. Obrigatório se houver mais de um."),
    amount: amountBrl.describe("Valor TOTAL da compra em reais"),
    installments: z.number().int().min(1).max(48).default(1),
    description: shortText(140),
    category: shortText(40),
    date: isoDate.optional(),
  }),
  mode: "write",
  run: (ctx, input) =>
    guard(async () => {
      const date = checkDate(ctx, input.date);
      if (typeof date !== "string") return { result: date };
      const cards = (await ctx.services.cards.list(ctx.userId)).filter((c) => !c.archived);
      const card = resolveByName(cards, input.card);
      if (!card.ok) return clarification("cartão", card);
      const cat = await categoryFor(ctx, input.category, "expense");
      if (!cat.ok) return clarification("categoria", cat);
      const p = await ctx.services.cards.createPurchase(
        ctx.userId,
        {
          creditCardId: card.item.id,
          description: input.description,
          totalAmountCents: toCents(input.amount),
          installmentCount: input.installments,
          purchaseDate: date,
          categoryId: cat.item.id,
          notes: null,
        },
        ctx.requestId,
      );
      return {
        result: { status: "created", id: p.id, card: card.item.name, total: brl(p.totalAmountCents), installments: p.installmentCount, date: p.purchaseDate },
        card: {
          kind: "created",
          title: "Compra no cartão registrada",
          lines: [
            `${p.description} · ${brl(p.totalAmountCents)}${p.installmentCount > 1 ? ` em ${p.installmentCount}x` : ""}`,
            `${card.item.name} · ${cat.item.name} · ${p.purchaseDate.split("-").reverse().join("/")}`,
          ],
          undo: { method: "DELETE", path: `/api/v1/card-purchases/${p.id}` },
        },
      };
    }),
});

const createGoal = defineTool({
  name: "create_goal",
  description: "Cria uma meta financeira. Se o usuário não der um nome, pergunte antes de criar.",
  schema: z.object({ name: shortText(60), target_amount: amountBrl, target_date: isoDate.optional() }),
  mode: "write",
  run: (ctx, input) =>
    guard(async () => {
      const g = await ctx.services.goals.create(
        ctx.userId,
        { name: input.name, targetAmountCents: toCents(input.target_amount), targetDate: input.target_date ?? null },
        ctx.requestId,
      );
      return {
        result: { status: "created", id: g.id, name: g.name, target: brl(g.targetAmountCents), target_date: g.targetDate, monthly_needed_estimate: g.monthlyNeededCents ? brl(g.monthlyNeededCents) : null },
        card: {
          kind: "created",
          title: "Meta criada",
          lines: [`${g.name} · ${brl(g.targetAmountCents)}${g.targetDate ? ` até ${g.targetDate.split("-").reverse().join("/")}` : ""}`],
          undo: { method: "POST", path: `/api/v1/goals/${g.id}/archive` },
        },
      };
    }),
});

const addGoalContribution = defineTool({
  name: "add_goal_contribution",
  description: "Registra um aporte (valor separado) numa meta existente.",
  schema: z.object({ goal: shortText(60), amount: amountBrl, date: isoDate.optional() }),
  mode: "write",
  run: (ctx, input) =>
    guard(async () => {
      const goals = (await ctx.services.goals.list(ctx.userId)).filter((g) => g.status !== "archived");
      const r = resolveByName(goals, input.goal);
      if (!r.ok) return clarification("meta", r);
      const g = await ctx.services.goals.contribute(ctx.userId, r.item.id, { amountCents: toCents(input.amount), date: input.date ?? ctx.today, note: "via NORBIUS" }, ctx.requestId);
      return {
        result: { status: "created", goal: g.name, contributed: brl(toCents(input.amount)), current: brl(g.currentAmountCents), progress_pct: Math.round(g.progress * 100), completed: g.status === "completed" },
        card: { kind: "created", title: "Aporte registrado", lines: [`${g.name} · + ${brl(toCents(input.amount))}`, `${Math.round(g.progress * 100)}% de ${brl(g.targetAmountCents)}`] },
      };
    }),
});

const remember = defineTool({
  name: "remember",
  description:
    "Guarda uma preferência ou fato declarado pelo usuário para conversas futuras (ex.: 'recebo no dia 5', 'prefiro respostas curtas'). Nunca guarde dados sensíveis (saúde, religião, política, documentos) nem valores de saldo — saldos são sempre consultados ao vivo.",
  schema: z.object({ content: shortText(300), kind: z.enum(["preference", "fact", "context"]) }),
  mode: "write",
  run: async (ctx, input) => {
    const id = await ctx.services.memories.add(ctx.userId, input.content, input.kind);
    if (!id) return { result: { status: "error", message: "Limite de memórias atingido. Peça ao usuário para remover alguma em Configurações." } };
    return {
      result: { status: "saved", id },
      card: { kind: "created", title: "Memória salva", lines: [input.content], undo: { method: "DELETE", path: `/api/v1/ai/memories/${id}` } },
    };
  },
});

// ── Exigem confirmação ──────────────────────────────────────
const createTransfer = defineTool({
  name: "create_transfer",
  description: "Propõe uma transferência entre duas contas do usuário. O usuário precisa confirmar no cartão exibido.",
  schema: z.object({ from_account: shortText(60), to_account: shortText(60), amount: amountBrl, date: isoDate.optional() }),
  mode: "confirm",
  preview: async (ctx, input) => {
    const accounts = await accountsOf(ctx);
    const from = resolveByName(accounts, input.from_account);
    if (!from.ok) return clarification("conta de origem", from);
    const to = resolveByName(accounts, input.to_account);
    if (!to.ok) return clarification("conta de destino", to);
    return { title: "Confirmar transferência", lines: [`${brl(toCents(input.amount))}`, `${from.item.name} → ${to.item.name}`, `Data: ${(input.date ?? ctx.today).split("-").reverse().join("/")}`] };
  },
  run: (ctx, input) =>
    guard(async () => {
      const accounts = await accountsOf(ctx);
      const from = resolveByName(accounts, input.from_account);
      const to = resolveByName(accounts, input.to_account);
      if (!from.ok || !to.ok) return { result: { status: "error", message: "Conta não encontrada." } };
      const t = await ctx.services.transactions.create(
        ctx.userId,
        { type: "transfer", accountId: from.item.id, transferAccountId: to.item.id, amountCents: toCents(input.amount), date: input.date ?? ctx.today, notes: null },
        ctx.requestId,
        "ai",
      );
      return {
        result: { status: "executed", id: t.id },
        card: { kind: "created", title: "Transferência registrada", lines: [`${brl(t.amountCents)} · ${from.item.name} → ${to.item.name}`], undo: { method: "DELETE", path: `/api/v1/transactions/${t.id}` } },
      };
    }),
});

const updateTransaction = defineTool({
  name: "update_transaction",
  description:
    "Propõe alterar uma movimentação existente (valor, descrição, categoria ou data). Use o id obtido em search_transactions. O usuário precisa confirmar.",
  schema: z.object({
    transaction_id: z.uuid(),
    amount: amountBrl.optional(),
    description: shortText(140).optional(),
    category: z.string().trim().max(40).optional(),
    date: isoDate.optional(),
  }),
  mode: "confirm",
  preview: (ctx, input) =>
    guard(async () => {
      const t = await ctx.services.transactions.get(ctx.userId, input.transaction_id);
      if (t.type === "transfer") return { result: { status: "error", message: "Transferências só podem ser alteradas na tela de transações." } };
      const lines = [`${t.description} · ${brl(t.amountCents)} · ${t.date.split("-").reverse().join("/")}`];
      if (input.amount !== undefined) lines.push(`Valor: ${brl(t.amountCents)} → ${brl(toCents(input.amount))}`);
      if (input.description) lines.push(`Descrição: ${t.description} → ${input.description}`);
      if (input.category) lines.push(`Categoria: ${t.category?.name} → ${input.category}`);
      if (input.date) lines.push(`Data: ${t.date.split("-").reverse().join("/")} → ${input.date.split("-").reverse().join("/")}`);
      if (lines.length === 1) return { result: { status: "error", message: "Nenhuma alteração informada." } };
      return { title: "Confirmar alteração", lines };
    }),
  run: (ctx, input) =>
    guard(async () => {
      const t = await ctx.services.transactions.get(ctx.userId, input.transaction_id);
      if (t.type === "transfer") return { result: { status: "error", message: "Transferências não podem ser alteradas por aqui." } };
      let categoryId = t.category!.id;
      if (input.category) {
        const cat = await categoryFor(ctx, input.category, t.type);
        if (!cat.ok) return clarification("categoria", cat);
        categoryId = cat.item.id;
      }
      const updated = await ctx.services.transactions.update(
        ctx.userId,
        t.id,
        {
          type: t.type,
          accountId: t.account.id,
          amountCents: input.amount !== undefined ? toCents(input.amount) : t.amountCents,
          categoryId,
          description: input.description ?? t.description,
          date: input.date ?? t.date,
          paymentMethod: (t.paymentMethod as "pix" | null) ?? null,
          notes: t.notes,
        },
        ctx.requestId,
      );
      return {
        result: { status: "executed", id: updated.id, amount: brl(updated.amountCents), description: updated.description },
        card: { kind: "updated", title: "Movimentação alterada", lines: [`${updated.description} · ${brl(updated.amountCents)}`] },
      };
    }),
});

const deleteTransaction = defineTool({
  name: "delete_transaction",
  description: "Propõe excluir uma movimentação (use o id de search_transactions). O usuário precisa confirmar; a exclusão pode ser desfeita.",
  schema: z.object({ transaction_id: z.uuid() }),
  mode: "confirm",
  preview: (ctx, input) =>
    guard(async () => {
      const t = await ctx.services.transactions.get(ctx.userId, input.transaction_id);
      return { title: "Confirmar exclusão", lines: [`${t.description} · ${brl(t.amountCents)} · ${t.date.split("-").reverse().join("/")}`, t.account.name] };
    }),
  run: (ctx, input) =>
    guard(async () => {
      const t = await ctx.services.transactions.get(ctx.userId, input.transaction_id);
      await ctx.services.transactions.remove(ctx.userId, t.id, ctx.requestId);
      return {
        result: { status: "executed" },
        card: { kind: "updated", title: "Movimentação excluída", lines: [`${t.description} · ${brl(t.amountCents)}`], undo: { method: "POST", path: `/api/v1/transactions/${t.id}/restore` } },
      };
    }),
});

const createRecurring = defineTool({
  name: "create_recurring",
  description: "Propõe cadastrar uma conta fixa mensal (despesa) ou receita recorrente mensal. O usuário precisa confirmar.",
  schema: z.object({
    type: z.enum(["income", "expense"]),
    description: shortText(140),
    amount: amountBrl,
    day_of_month: z.number().int().min(1).max(31),
    category: shortText(40),
    account: z.string().trim().max(60).optional(),
    amount_is_estimate: z.boolean().default(false),
  }),
  mode: "confirm",
  preview: async (ctx, input) => {
    const acc = resolveByName(await accountsOf(ctx), input.account);
    if (!acc.ok) return clarification("conta", acc);
    const cat = await categoryFor(ctx, input.category, input.type);
    if (!cat.ok) return clarification("categoria", cat);
    return {
      title: input.type === "income" ? "Confirmar receita recorrente" : "Confirmar conta fixa",
      lines: [`${input.description} · ${brl(toCents(input.amount))}${input.amount_is_estimate ? " (estimado)" : ""}`, `Todo dia ${input.day_of_month} · ${cat.item.name} · ${acc.item.name}`],
    };
  },
  run: (ctx, input) =>
    guard(async () => {
      const acc = resolveByName(await accountsOf(ctx), input.account);
      const cat = await categoryFor(ctx, input.category, input.type);
      if (!acc.ok || !cat.ok) return { result: { status: "error", message: "Conta ou categoria não encontrada." } };
      const r = await ctx.services.recurring.create(
        ctx.userId,
        {
          type: input.type,
          accountId: acc.item.id,
          creditCardId: null,
          amountCents: toCents(input.amount),
          amountIsEstimate: input.amount_is_estimate,
          categoryId: cat.item.id,
          description: input.description,
          frequency: "monthly",
          dayOfMonth: input.day_of_month,
          startDate: ctx.today,
          endDate: null,
        },
        ctx.requestId,
      );
      return {
        result: { status: "executed", id: r.id, next_date: r.nextDate },
        card: { kind: "created", title: "Recorrência cadastrada", lines: [`${r.description} · ${brl(r.amountCents)} · todo dia ${input.day_of_month}`] },
      };
    }),
});

export const TOOLS: ToolDef[] = [
  getFinancialOverview,
  searchTransactions,
  getSpendingByCategory,
  comparePeriods,
  listUpcomingBills,
  getCreditCards,
  getGoals,
  createTransaction,
  createCardPurchase,
  createGoal,
  addGoalContribution,
  remember,
  createTransfer,
  updateTransaction,
  deleteTransaction,
  createRecurring,
] as ToolDef[];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
