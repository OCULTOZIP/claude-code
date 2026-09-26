import { PLANS } from "@/lib/content";
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
            {!plan.available ? <Badge tone="primary">Em breve</Badge> : null}
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
          {plan.cta ? (
            <Link href={plan.cta.href} className={buttonClasses({ className: "mt-8" })}>
              {plan.cta.label}
            </Link>
          ) : (
            <p className="mt-8 rounded-xl border border-line px-4 py-3 text-center text-sm text-fg-muted">
              Valores divulgados antes do lançamento
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
