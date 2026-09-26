import { cn } from "../cn";

/** Marca do NORBIUS: núcleo (anel + ponto vermelho) e logotipo. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <path d="M16 2a14 14 0 0 1 14 14" fill="none" stroke="#E50914" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="4.5" fill="#E50914" />
    </svg>
  );
}

export function Logo({ className, withMark = true }: { className?: string; withMark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-fg", className)}>
      {withMark ? <LogoMark /> : null}
      <span className="text-[15px] font-semibold tracking-[0.28em]">NORBIUS</span>
    </span>
  );
}
