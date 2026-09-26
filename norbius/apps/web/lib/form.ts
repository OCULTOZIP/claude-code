import type { z } from "zod";

export type FieldErrors = Record<string, string | undefined>;

/** Valida com o schema compartilhado e devolve o primeiro erro de cada campo. */
export function validate<T extends z.ZodType>(
  schema: T,
  data: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "_");
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Aceita só caminhos internos, evitando redirecionamento aberto. */
export function safeNext(next: string | null | undefined, fallback = "/dashboard") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
