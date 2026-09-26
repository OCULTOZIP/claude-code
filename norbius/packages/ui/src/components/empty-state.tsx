import type { ReactNode } from "react";
import { cn } from "../cn";

export function EmptyState({ title, description, action, className }: { title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-12 text-center", className)}>
      <span aria-hidden className="size-2 rounded-full bg-primary shadow-[0_0_14px_#E50914]" />
      <h3 className="mt-5 font-semibold">{title}</h3>
      {description ? <p className="mt-2 max-w-sm text-sm leading-relaxed text-fg-secondary">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
