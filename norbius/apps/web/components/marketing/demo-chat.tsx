import { Badge } from "@norbius/ui";

// Conversa ILUSTRATIVA do assistente. Não representa dados reais.
const MESSAGES = [
  { from: "user", text: "Gastei 50 reais no mercado." },
  { from: "norbius", text: "Registrei R$ 50,00 em Alimentação, hoje, na sua conta principal.", action: "Desfazer" },
  { from: "user", text: "Quanto vai sobrar no final do mês?" },
  {
    from: "norbius",
    text: "Estimativa: entre R$ 820 e R$ 1.240, mais provável R$ 1.030. Considerei o aluguel no dia 5 e a fatura do cartão no dia 10.",
  },
] as const;

export function DemoChat() {
  return (
    <div className="rounded-card border border-line bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-primary shadow-[0_0_12px_#E50914]" />
          <span className="text-sm font-medium">NORBIUS</span>
        </div>
        <Badge>Exemplo ilustrativo</Badge>
      </div>
      <ul className="mt-5 flex flex-col gap-3">
        {MESSAGES.map((m, i) => (
          <li key={i} className={m.from === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.from === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm"
                  : "max-w-[85%] rounded-2xl rounded-bl-md border border-line-strong bg-surface px-4 py-2.5 text-sm text-fg-secondary"
              }
            >
              {m.text}
              {"action" in m ? (
                <span className="mt-2 block text-xs font-medium text-primary-light">{m.action}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
