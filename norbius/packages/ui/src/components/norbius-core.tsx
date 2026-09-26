import { cn } from "../cn";

export type CoreState = "ACTIVE" | "ANALYZING" | "STABLE" | "ATTENTION" | "OPTIMIZING";

const STATE_META: Record<CoreState, { label: string; ring: string; glow: string; dot: string }> = {
  ACTIVE: { label: "Ativo", ring: "stroke-fg/40", glow: "bg-fg/10", dot: "bg-fg" },
  ANALYZING: { label: "Analisando", ring: "stroke-primary", glow: "bg-primary/20", dot: "bg-primary-light" },
  STABLE: { label: "Estável", ring: "stroke-success/70", glow: "bg-success/15", dot: "bg-success" },
  ATTENTION: { label: "Atenção", ring: "stroke-primary", glow: "bg-primary/35", dot: "bg-primary" },
  OPTIMIZING: { label: "Otimizando", ring: "stroke-warning/80", glow: "bg-warning/15", dot: "bg-warning" },
};

/**
 * NORBIUS CORE — representa o estado real da inteligência financeira.
 * O estado deve sempre vir do servidor; o componente nunca simula atividade.
 * `ANALYZING` só deve ser usado enquanto houver processamento real em curso.
 */
export function NorbiusCore({
  state,
  size = 160,
  className,
}: {
  state: CoreState;
  size?: number;
  className?: string;
}) {
  const meta = STATE_META[state];
  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`NORBIUS CORE: ${meta.label}`}
    >
      <span className={cn("absolute inset-[18%] rounded-full blur-2xl animate-core-pulse", meta.glow)} />
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        <circle cx="50" cy="50" r="46" fill="none" className="stroke-line-strong" strokeWidth="0.75" />
        <circle cx="50" cy="50" r="38" fill="none" className="stroke-line" strokeWidth="0.75" strokeDasharray="1 3" />
      </svg>
      <svg
        viewBox="0 0 100 100"
        className={cn("absolute inset-0 size-full", state === "ANALYZING" && "animate-core-spin")}
      >
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          className={meta.ring}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="72 217"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="relative grid size-[34%] place-items-center rounded-full border border-line-strong bg-surface">
        <span className={cn("size-[34%] rounded-full shadow-[0_0_24px_currentColor]", meta.dot)} />
      </span>
    </div>
  );
}

export function coreStateLabel(state: CoreState) {
  return STATE_META[state].label;
}
