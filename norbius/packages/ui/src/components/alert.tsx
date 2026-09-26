import type { HTMLAttributes } from "react";
import { cn } from "../cn";

const tones = {
  info: "border-line-strong bg-secondary text-fg-secondary",
  error: "border-primary-dark bg-primary/10 text-[#ffb3b6]",
  success: "border-success/30 bg-success/10 text-[#b7f5cd]",
  warning: "border-warning/30 bg-warning/10 text-[#fde0a8]",
} as const;

export function Alert({
  tone = "info",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof tones }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-xl border px-4 py-3 text-sm leading-relaxed", tones[tone], className)}
      {...props}
    />
  );
}
