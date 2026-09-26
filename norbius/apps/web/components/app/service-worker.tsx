"use client";
import { useEffect } from "react";

/** Registra o service worker só em produção (em desenvolvimento ele atrapalharia o recarregamento automático). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
