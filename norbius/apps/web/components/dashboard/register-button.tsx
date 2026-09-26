"use client";
import type { TransactionDialogData } from "@/components/finance/transaction-dialog";
import { Button } from "@norbius/ui";
import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

// O formulário (e o zod das validações) só carrega no clique: o painel abre mais leve.
const TransactionDialog = dynamic(() => import("@/components/finance/transaction-dialog").then((m) => m.TransactionDialog), {
  ssr: false,
});

export function RegisterButton({ data, label = "Registrar" }: { data: TransactionDialogData; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} onPointerEnter={() => void import("@/components/finance/transaction-dialog")}>
        <Plus aria-hidden className="size-4" /> {label}
      </Button>
      {open ? <TransactionDialog open onClose={() => setOpen(false)} data={data} /> : null}
    </>
  );
}
