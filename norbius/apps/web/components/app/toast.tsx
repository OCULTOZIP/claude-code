"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Toast = { id: number; message: string; action?: { label: string; onClick: () => void | Promise<void> } };
type Ctx = { show: (message: string, action?: Toast["action"]) => void };

const ToastContext = createContext<Ctx>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback((message: string, action?: Toast["action"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, action }]);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, toast.action ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [toast, onDone]);
  return (
    <div
      role="status"
      className="pointer-events-auto flex animate-fade-up items-center gap-4 rounded-2xl border border-line-strong bg-secondary px-4 py-3 text-sm shadow-2xl shadow-black/60"
    >
      <span>{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className="font-medium text-primary-light hover:text-fg"
          onClick={async () => {
            await toast.action!.onClick();
            onDone();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
    </div>
  );
}
