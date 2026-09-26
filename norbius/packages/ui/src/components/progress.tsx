import { cn } from "../cn";

/** `label` nomeia a barra para leitores de tela (ex.: "Progresso da meta Viagem"). */
export function Progress({
  value,
  label,
  className,
  tone = "fg",
}: {
  value: number;
  label: string;
  className?: string;
  tone?: "fg" | "primary" | "success";
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = tone === "primary" ? "bg-primary" : tone === "success" ? "bg-success" : "bg-fg/80";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
