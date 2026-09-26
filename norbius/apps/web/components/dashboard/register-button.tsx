"use client";
import { TransactionDialog, type TransactionDialogData } from "@/components/finance/transaction-dialog";
import { Button } from "@norbius/ui";
import { Plus } from "lucide-react";
import { useState } from "react";

export function RegisterButton({ data, label = "Registrar" }: { data: TransactionDialogData; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-4" /> {label}
      </Button>
      {open ? <TransactionDialog open onClose={() => setOpen(false)} data={data} /> : null}
    </>
  );
}
