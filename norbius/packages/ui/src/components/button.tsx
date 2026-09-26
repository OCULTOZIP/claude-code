import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn";
import { Spinner } from "./spinner";

const variants = {
  primary:
    "bg-primary text-white hover:bg-primary-light active:bg-primary-dark shadow-[0_0_0_1px_rgba(229,9,20,0.4),0_8px_24px_-8px_rgba(229,9,20,0.55)]",
  secondary: "bg-secondary text-fg border border-line-strong hover:border-fg-muted hover:bg-[#202024]",
  ghost: "text-fg-secondary hover:text-fg hover:bg-secondary",
  danger: "bg-transparent text-primary-light border border-primary-dark hover:bg-primary-dark/25",
} as const;

const sizes = {
  sm: "h-9 px-3.5 text-sm rounded-lg",
  md: "h-11 px-5 text-sm rounded-xl",
  lg: "h-12 px-6 text-base rounded-xl",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

/** Classes do botão, reutilizáveis em links (<a>/<Link>). */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 select-none",
    "disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function Button({ variant, size, loading, className, children, disabled, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : null}
      {children}
    </button>
  );
}
