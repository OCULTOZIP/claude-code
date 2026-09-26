"use client";
import { brl, shortDate } from "@/lib/format";
import { useState } from "react";

// Paleta validada (scripts/validate_palette.js, modo escuro, superfície #121214):
// receitas #3B82F6 · despesas #E50914 — todas as checagens passam.
const INCOME = "#3B82F6";
const EXPENSE = "#E50914";

type Day = { date: string; incomeCents: number; expenseCents: number };

export function FlowChart({ days, today }: { days: Day[]; today: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...days.map((d) => Math.max(d.incomeCents, d.expenseCents)));
  const hasAny = days.some((d) => d.incomeCents || d.expenseCents);
  const focused = active !== null ? days[active] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-fg-secondary" aria-label="Legenda">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: INCOME }} /> Receitas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: EXPENSE }} /> Despesas
          </span>
        </div>
        <button type="button" onClick={() => setTable((t) => !t)} className="text-xs text-fg-muted hover:text-fg">
          {table ? "Ver gráfico" : "Ver tabela"}
        </button>
      </div>

      {table ? (
        <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Dia</th>
                <th className="px-3 py-2 text-right font-medium">Receitas</th>
                <th className="px-3 py-2 text-right font-medium">Despesas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular">
              {days
                .filter((d) => d.incomeCents || d.expenseCents)
                .map((d) => (
                  <tr key={d.date}>
                    <td className="px-3 py-2 text-fg-secondary">{shortDate(d.date)}</td>
                    <td className="px-3 py-2 text-right">{d.incomeCents ? brl(d.incomeCents) : "—"}</td>
                    <td className="px-3 py-2 text-right">{d.expenseCents ? brl(d.expenseCents) : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-4">
          <div className="flex h-40 items-end gap-[2px]" role="img" aria-label="Receitas e despesas por dia do mês">
            {days.map((d, i) => {
              const future = d.date > today;
              return (
                <button
                  key={d.date}
                  type="button"
                  tabIndex={future ? -1 : 0}
                  aria-label={`${shortDate(d.date)}: receitas ${brl(d.incomeCents)}, despesas ${brl(d.expenseCents)}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-sm outline-offset-0 hover:bg-fg/[0.03]"
                >
                  {future ? (
                    <span className="h-px w-full bg-line" />
                  ) : (
                    <>
                      <span
                        className="w-full max-w-2 rounded-t-[4px] transition-opacity"
                        style={{ height: `${(d.incomeCents / max) * 100}%`, background: INCOME, opacity: active === null || active === i ? 1 : 0.45 }}
                      />
                      <span
                        className="w-full max-w-2 rounded-t-[4px] transition-opacity"
                        style={{ height: `${(d.expenseCents / max) * 100}%`, background: EXPENSE, opacity: active === null || active === i ? 1 : 0.45 }}
                      />
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-fg-muted tabular">
            <span>{shortDate(days[0]!.date)}</span>
            <span>{shortDate(days.at(-1)!.date)}</span>
          </div>
          {focused ? (
            <div className="pointer-events-none absolute -top-2 right-0 rounded-xl border border-line-strong bg-secondary px-3 py-2 text-xs shadow-xl">
              <p className="text-fg-muted">{shortDate(focused.date)}</p>
              <p className="mt-1 flex items-center gap-2">
                <span className="h-0.5 w-3" style={{ background: INCOME }} />
                <strong className="font-semibold tabular">{brl(focused.incomeCents)}</strong>
                <span className="text-fg-muted">receitas</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="h-0.5 w-3" style={{ background: EXPENSE }} />
                <strong className="font-semibold tabular">{brl(focused.expenseCents)}</strong>
                <span className="text-fg-muted">despesas</span>
              </p>
            </div>
          ) : null}
          {!hasAny ? (
            <p className="absolute inset-0 grid place-items-center text-sm text-fg-muted">Sem movimentações neste mês.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
