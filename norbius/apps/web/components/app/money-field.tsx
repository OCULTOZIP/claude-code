"use client";
import { formatBRL, parseBRL } from "@norbius/domain";
import { Field } from "@norbius/ui";
import { useState } from "react";

/**
 * Campo de valor em reais aceitando digitação livre pt-BR ("50", "1.234,56").
 * Envia centavos num input oculto com o mesmo `name`.
 */
export function MoneyField({
  label,
  name,
  defaultCents,
  error,
  hint,
  allowNegative = false,
  autoFocus,
}: {
  label: string;
  name: string;
  defaultCents?: number | null;
  error?: string | undefined;
  hint?: string;
  allowNegative?: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(defaultCents != null ? formatBRL(defaultCents).replace("R$ ", "") : "");
  const cents = parseBRL(text);
  const invalid = text.trim() !== "" && (cents === null || (!allowNegative && cents < 0));
  return (
    <>
      <Field
        label={label}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (cents !== null && !invalid) setText(formatBRL(cents).replace("R$ ", "").replace(/^-R\$\s?/, "-"));
        }}
        error={invalid ? "Valor inválido. Ex.: 1.234,56" : error}
        hint={hint}
      />
      <input type="hidden" name={name} value={cents !== null && !invalid ? String(cents) : ""} />
    </>
  );
}

/** Lê centavos de um FormData (campo oculto do MoneyField). */
export function centsFrom(form: FormData, name: string): number | undefined {
  const v = form.get(name);
  if (typeof v !== "string" || v === "") return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : undefined;
}
