import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../cn";

export const inputClasses = cn(
  "h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-sm text-fg",
  "placeholder:text-fg-muted transition-colors",
  "hover:border-fg-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25",
  "aria-[invalid=true]:border-primary-dark",
  "disabled:opacity-60",
);

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
};

/** Campo de formulário acessível: rótulo, dica e erro associados ao input. */
export function Field({ label, error, hint, id, className, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-fg-secondary">
        {label}
      </label>
      <input
        id={inputId}
        className={inputClasses}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-primary-light">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
