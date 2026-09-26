"use client";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` no HTML do servidor e até a hidratação; `true` depois.
 * Usado para manter botões de envio desabilitados enquanto o React não
 * assumiu o formulário (evita envio nativo com dados na URL).
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
