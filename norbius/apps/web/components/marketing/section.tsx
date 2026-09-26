import { cn } from "@norbius/ui";

export function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28", className)}>
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="font-mono text-xs tracking-[0.24em] text-primary-light uppercase">{eyebrow}</p>
        ) : null}
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
        {description ? <p className="mt-4 text-base leading-relaxed text-fg-secondary text-pretty">{description}</p> : null}
      </div>
      {children ? <div className="mt-12">{children}</div> : null}
    </section>
  );
}
