import { useId, type SelectHTMLAttributes } from "react";
import { cn } from "../cn";
import { ChevronDown } from "./icons";

export const selectClasses = cn(
  "h-11 w-full appearance-none rounded-xl border border-line-strong bg-surface pr-10 pl-3.5 text-sm text-fg",
  "hover:border-fg-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25",
  "aria-[invalid=true]:border-primary-dark disabled:opacity-60",
);

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string | undefined;
  options: { value: string; label: string }[];
  placeholder?: string;
};

/** Select nativo estilizado (melhor acessibilidade e UX no celular). */
export function SelectField({ label, error, options, placeholder, id, className, ...props }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={selectId} className="text-sm font-medium text-fg-secondary">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          className={selectClasses}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${selectId}-error` : undefined}
          {...props}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted" />
      </div>
      {error ? (
        <p id={`${selectId}-error`} className="text-xs text-primary-light">
          {error}
        </p>
      ) : null}
    </div>
  );
}
