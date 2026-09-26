import { appIcon } from "@/lib/app-icon";

// Ícones do manifesto PWA: /icons/192, /icons/512, /icons/maskable-512.
const VARIANTS: Record<string, { size: number; padding: number }> = {
  "192": { size: 192, padding: 0.14 },
  "512": { size: 512, padding: 0.14 },
  "maskable-512": { size: 512, padding: 0.24 },
};

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ variant: string }> }) {
  const v = VARIANTS[(await params).variant];
  if (!v) return new Response("Not found", { status: 404 });
  return appIcon(v.size, v.padding);
}
