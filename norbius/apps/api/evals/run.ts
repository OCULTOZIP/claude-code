/**
 * Avaliação do NORBIUS AI contra o modelo real.
 *
 * Custa dinheiro a cada execução: só roda com ANTHROPIC_API_KEY definida.
 *   pnpm --filter @norbius/api eval:ai            (todos os casos)
 *   EVAL_ONLY=spend-market,q-food pnpm ... eval:ai (subconjunto)
 *
 * Mede apenas a primeira decisão do modelo (nenhuma tool é executada) com um
 * contexto fixo e fictício — os dados abaixo existem só para a avaliação.
 */
import { loadEnv } from "../src/env";
import { AnthropicLlm } from "../src/modules/ai/llm";
import { contextBlock, SYSTEM_PROMPT } from "../src/modules/ai/prompt";
import { normalize } from "../src/modules/ai/tools/resolve";
import { toolDefinitions } from "../src/modules/ai/orchestrator";
import { TOOLS_BY_NAME } from "../src/modules/ai/tools";
import { CASES } from "./cases";

const THRESHOLD = Number(process.env.EVAL_THRESHOLD ?? 0.85);
const WRITE_TOOLS = new Set([...TOOLS_BY_NAME.values()].filter((t) => t.mode !== "read").map((t) => t.name));

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY não definida — avaliação ignorada (ela chama o modelo real e tem custo).");
  process.exit(0);
}

const env = loadEnv({
  ...process.env,
  APP_URL: process.env.APP_URL ?? "http://localhost:3000",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://unused@localhost/unused",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "eval-secret-with-at-least-32-characters!!",
});
const llm = new AnthropicLlm(env);

// Contexto fixo de avaliação (fictício).
const system = [
  { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
  contextBlock({
    today: "2026-09-26",
    timezone: "America/Sao_Paulo",
    displayName: "Ana",
    accounts: [
      { name: "Nubank", type: "checking", balance: "R$ 2.450,00" },
      { name: "Itaú", type: "checking", balance: "R$ 830,15" },
      { name: "Reserva", type: "savings", balance: "R$ 12.000,00" },
    ],
    cards: [{ name: "Roxinho" }],
    expenseCategories: ["Alimentação", "Moradia", "Transporte", "Saúde", "Educação", "Lazer", "Compras", "Assinaturas", "Contas", "Investimentos", "Outros"],
    incomeCategories: ["Salário", "Investimentos", "Outros"],
    memories: [],
    recentActions: [],
  }),
];

const MONEY = /R\$\s?-?\d/;
const eq = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" ? normalize(a).includes(normalize(b)) : a === b;

type Row = { id: string; pass: boolean; got: string; why?: string };
const rows: Row[] = [];
const only = process.env.EVAL_ONLY?.split(",");

for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
  const { message } = await llm.stream({ system, tools: toolDefinitions(), messages: [{ role: "user", content: c.utterance }] }, () => {});
  const uses = message.content.filter((b) => b.type === "tool_use") as { name: string; input: Record<string, unknown> }[];
  const text = message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ");
  const got = uses.length ? uses.map((u) => `${u.name}(${JSON.stringify(u.input)})`).join(" + ") : `texto: ${text.slice(0, 120)}`;
  let pass = true;
  let why: string | undefined;
  if (c.tool) {
    const hit = uses.find((u) => c.tool!.includes(u.name));
    if (!hit) [pass, why] = [false, `esperava ${c.tool.join("|")}`];
    else if (c.args) {
      for (const [k, v] of Object.entries(c.args)) {
        if (!eq(hit.input[k], v)) [pass, why] = [false, `argumento ${k}: esperado ${JSON.stringify(v)}, veio ${JSON.stringify(hit.input[k])}`];
      }
    }
  }
  if (c.noWrite && uses.some((u) => WRITE_TOOLS.has(u.name))) [pass, why] = [false, "executou/propôs escrita sem dados suficientes"];
  if (c.noInventedAmounts && !uses.length && MONEY.test(text)) [pass, why] = [false, "citou valor sem consultar dados"];
  rows.push({ id: c.id, pass, got, why });
  console.log(`${pass ? "✓" : "✗"} ${c.id.padEnd(20)} ${pass ? "" : `— ${why} · ${got}`}`);
}

const score = rows.filter((r) => r.pass).length / rows.length;
console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} (${Math.round(score * 100)}%) · limiar ${Math.round(THRESHOLD * 100)}% · modelo ${llm.model}`);
process.exit(score >= THRESHOLD ? 0 : 1);
