import { FAQ } from "@/lib/content";

export function FaqList({ limit }: { limit?: number }) {
  const items = limit ? FAQ.slice(0, limit) : FAQ;
  return (
    <div className="divide-y divide-line rounded-card border border-line bg-card">
      {items.map((item) => (
        <details key={item.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-left font-medium">
            {item.q}
            <span
              aria-hidden
              className="grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-fg-secondary transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fg-secondary">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
