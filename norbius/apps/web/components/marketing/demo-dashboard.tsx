import { Badge, NorbiusCore } from "@norbius/ui";

// Painel ILUSTRATIVO para o site. Os valores são fictícios e rotulados como tal.
const BARS = [38, 52, 44, 61, 57, 70, 64, 76, 58, 66, 72, 80];
const CATEGORIES = [
  { name: "Moradia", pct: 34 },
  { name: "Alimentação", pct: 26 },
  { name: "Transporte", pct: 14 },
  { name: "Lazer", pct: 9 },
];

export function DemoDashboard() {
  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-surface p-5 sm:p-7">
      <div className="pointer-events-none absolute -top-40 right-0 size-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex items-center justify-between">
        <p className="text-xs tracking-[0.2em] text-fg-muted uppercase">Visão geral</p>
        <Badge>Dados fictícios</Badge>
      </div>
      <div className="relative mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="text-sm text-fg-secondary">Saldo disponível</p>
          <p className="mt-1 text-3xl font-semibold tabular">R$ 8.420,15</p>
          <div className="mt-5 grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-fg-muted">Receitas</p>
              <p className="mt-0.5 font-medium text-success tabular">R$ 6.200</p>
            </div>
            <div>
              <p className="text-fg-muted">Despesas</p>
              <p className="mt-0.5 font-medium tabular">R$ 3.914</p>
            </div>
            <div>
              <p className="text-fg-muted">Investido</p>
              <p className="mt-0.5 font-medium tabular">R$ 1.500</p>
            </div>
          </div>
          <div className="mt-6 flex h-24 items-end gap-1.5" aria-hidden>
            {BARS.map((h, i) => (
              <span
                key={i}
                className={i === BARS.length - 1 ? "flex-1 rounded-sm bg-primary" : "flex-1 rounded-sm bg-secondary"}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-card p-5">
            <NorbiusCore state="STABLE" size={72} />
            <div>
              <p className="font-mono text-[11px] tracking-[0.2em] text-success">STABLE</p>
              <p className="mt-1 text-sm text-fg-secondary">Nenhum alerta. Sobra estimada de R$ 1.030.</p>
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-card p-5">
            <p className="text-sm text-fg-secondary">Categorias do mês</p>
            <ul className="mt-4 flex flex-col gap-3">
              {CATEGORIES.map((c) => (
                <li key={c.name} className="text-xs">
                  <div className="flex justify-between text-fg-secondary">
                    <span>{c.name}</span>
                    <span className="tabular">{c.pct}%</span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-secondary">
                    <div className="h-1 rounded-full bg-fg/70" style={{ width: `${c.pct * 2.5}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
