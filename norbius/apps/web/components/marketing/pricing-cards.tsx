import { PLANS } from "@/lib/content";
import { TRIAL_DAYS } from "@norbius/domain";
import { Badge, buttonClasses, cn } from "@norbius/ui";
import { Check } from "lucide-react";
import Link from "next/link";

export function PricingCards() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {PLANS.map((plan) => (
        <div
          key={plan.id}
          className={cn(
            "relative flex flex-col rounded-card border bg-card p-7",
            plan.id === "pro" ? "border-primary-dark/70" : "border-line",
          )}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            {plan.id === "pro" ? <Badge tone="primary">{TRIAL_DAYS} dias grátis</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-fg-secondary">{plan.description}</p>
          <p className="mt-6 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular">{plan.price}</span>
            {plan.period ? <span className="text-sm text-fg-muted">{plan.period}</span> : null}
          </p>
          <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm">
            {plan.features.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-fg-secondary">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                {f}
              </li>
            ))}
          </ul>
          <Link href={plan.cta.href} className={buttonClasses({ className: "mt-8", variant: plan.id === "pro" ? "primary" : "secondary" })}>
            {plan.cta.label}
          </Link>
        </div>
      ))}
    </div>
  );
}
