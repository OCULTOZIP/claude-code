"use client";
import { X } from "./icons";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../cn";

/**
 * Diálogo modal acessível baseado em <dialog> nativo (foco preso, Esc fecha,
 * fundo inerte). No celular vira uma folha que sobe da base.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
      className={cn(
        "m-0 mt-auto w-full max-w-none rounded-t-3xl border border-line bg-card p-0 text-fg backdrop:bg-black/70 backdrop:backdrop-blur-sm",
        "sm:m-auto sm:max-w-lg sm:rounded-3xl",
        "open:animate-fade-up",
        className,
      )}
    >
      {open ? (
        <div className="max-h-[88dvh] overflow-y-auto p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="text-lg font-semibold">
                {title}
              </h2>
              {description ? <p className="mt-1 text-sm text-fg-secondary">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="-mt-1 -mr-2 grid size-9 place-items-center rounded-full text-fg-secondary hover:bg-secondary hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-6">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
