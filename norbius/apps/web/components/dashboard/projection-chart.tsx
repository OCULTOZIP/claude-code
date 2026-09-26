"use client";
import { brl, shortDate } from "@/lib/format";
import type { ProjectionView } from "@norbius/contracts";
import { useId, useState } from "react";

// Mesma família do fluxo (validada: scripts/validate_palette.js, modo escuro, superfície #121214).
// Azul = saldo provável; vermelho só no trecho abaixo de zero (alerta), sempre com rótulo.
const LINE = "#3B82F6";
const NEGATIVE = "#E50914";
const W = 600;
const H = 180;

const CONFIDENCE = { low: "baixa", medium: "média", high: "alta" } as const;

export function ProjectionChart({ projection, today, balanceCents }: { projection: ProjectionView; today: string; balanceCents: number }) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const clipId = useId();
  // Começa em hoje (saldo real) para a curva sair do valor conhecido.
  const days = [{ date: today, p10: balanceCents, p50: balanceCents, p90: balanceCents }, ...projection.days];
  const values = days.flatMap((d) => [d.p10, d.p90]);
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values);
  const pad = (hi - lo) * 0.08 || 1;
  const min = lo < 0 ? lo - pad : 0;
  const max = hi + pad;
  const x = (i: number) => (i / (days.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.p50).toFixed(1)}`).join("");
  const band =
    days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.p90).toFixed(1)}`).join("") +
    [...days]
      .reverse()
      .map((d, j) => `L${x(days.length - 1 - j).toFixed(1)},${y(d.p10).toFixed(1)}`)
      .join("") +
    "Z";
  const zeroY = y(0);
  const goesNegative = days.some((d) => d.p50 < 0);
  const ticks = [max, (max + min) / 2, min].map((v) => Math.round(v / 100) * 100);
  const lowIdx = projection.lowest ? days.findIndex((d) => d.date === projection.lowest!.date) : -1;
  const end = days.at(-1)!;
  const focused = active !== null ? days[active]! : null;

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (days.length - 1));
    setActive(Math.max(0, Math.min(days.length - 1, i)));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-fg-secondary" aria-label="Legenda">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full" style={{ background: LINE }} /> Saldo provável
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: LINE, opacity: 0.2 }} /> Faixa provável (80%)
          </span>
          {goesNegative ? (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded-full" style={{ background: NEGATIVE }} /> Abaixo de zero
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <span>Confiança {CONFIDENCE[projection.confidence]}</span>
          <button type="button" onClick={() => setTable((t) => !t)} className="hover:text-fg">
            {table ? "Ver gráfico" : "Ver tabela"}
          </button>
        </div>
      </div>

      {table ? (
        <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Dia</th>
                <th className="px-3 py-2 text-right font-medium">Pessimista</th>
                <th className="px-3 py-2 text-right font-medium">Provável</th>
                <th className="px-3 py-2 text-right font-medium">Otimista</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular">
              {projection.days.map((d) => (
                <tr key={d.date}>
                  <td className="px-3 py-2 text-fg-secondary">{shortDate(d.date)}</td>
                  <td className="px-3 py-2 text-right">{brl(d.p10)}</td>
                  <td className="px-3 py-2 text-right">{brl(d.p50)}</td>
                  <td className="px-3 py-2 text-right">{brl(d.p90)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 flex gap-3">
          <div className="flex h-44 w-20 shrink-0 flex-col justify-between text-right text-[11px] text-fg-muted tabular" aria-hidden>
            {ticks.map((t, i) => (
              <span key={i}>{brl(t).replace(/,\d{2}$/, "")}</span>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <div
              className="relative h-44 touch-none"
              role="img"
              aria-label={`Projeção de saldo até ${shortDate(projection.horizonEnd)}: saldo provável de ${brl(end.p50)}, entre ${brl(end.p10)} e ${brl(end.p90)}.`}
              onPointerMove={onMove}
              onPointerLeave={() => setActive(null)}
            >
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
                <defs>
                  <clipPath id={clipId}>
                    <rect x={0} y={zeroY} width={W} height={Math.max(0, H - zeroY)} />
                  </clipPath>
                </defs>
                {[0, 0.5, 1].map((f) => (
                  <line key={f} x1={0} x2={W} y1={f * H} y2={f * H} stroke="currentColor" className="text-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
                {min < 0 ? (
                  <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="currentColor" className="text-fg-muted" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ) : null}
                <path d={band} fill={LINE} opacity={0.12} />
                <path d={line} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                {goesNegative ? (
                  <path d={line} fill="none" stroke={NEGATIVE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" clipPath={`url(#${clipId})`} />
                ) : null}
              </svg>
              {min < 0 ? (
                <span className="absolute right-0 -translate-y-full pb-0.5 text-[11px] text-fg-muted" style={{ top: `${(zeroY / H) * 100}%` }}>
                  R$ 0
                </span>
              ) : null}
              {/* Pontos: fim do período e menor saldo provável (anel na cor da superfície). */}
              {[days.length - 1, ...(lowIdx > 0 && lowIdx !== days.length - 1 ? [lowIdx] : [])].map((i) => (
                <span
                  key={i}
                  className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                  style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(days[i]!.p50) / H) * 100}%`, background: days[i]!.p50 < 0 ? NEGATIVE : LINE }}
                />
              ))}
              {focused && active !== null ? (
                <>
                  <span className="pointer-events-none absolute inset-y-0 w-px bg-fg-muted/50" style={{ left: `${(x(active) / W) * 100}%` }} />
                  <span
                    className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                    style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(focused.p50) / H) * 100}%`, background: focused.p50 < 0 ? NEGATIVE : LINE }}
                  />
                  <div
                    className="pointer-events-none absolute -top-2 rounded-xl border border-line-strong bg-secondary px-3 py-2 text-xs shadow-xl"
                    style={active > days.length / 2 ? { right: `${100 - (x(active) / W) * 100 + 2}%` } : { left: `${(x(active) / W) * 100 + 2}%` }}
                  >
                    <p className="text-fg-muted">{active === 0 ? "Hoje (real)" : shortDate(focused.date)}</p>
                    <p className="mt-1 flex items-center gap-2">
                      <span className="h-0.5 w-3" style={{ background: focused.p50 < 0 ? NEGATIVE : LINE }} />
                      <strong className="font-semibold tabular">{brl(focused.p50)}</strong>
                      <span className="text-fg-muted">provável</span>
                    </p>
                    {active > 0 ? (
                      <p className="mt-0.5 text-fg-muted tabular">
                        entre {brl(focused.p10)} e {brl(focused.p90)}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-fg-muted tabular">
              <span>Hoje</span>
              <span>
                {shortDate(projection.horizonEnd)} · provável {brl(end.p50)}
              </span>
            </div>
          </div>
        </div>
      )}

      <details className="mt-4 text-xs text-fg-secondary">
        <summary className="cursor-pointer text-fg-muted hover:text-fg">Como calculei (estimativa)</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          {projection.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
          <li>A faixa mostra onde o saldo deve ficar em 8 de cada 10 cenários simulados a partir do seu histórico.</li>
        </ul>
      </details>
    </div>
  );
}
