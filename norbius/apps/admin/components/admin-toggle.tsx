"use client";
import { adminPost } from "@/lib/client";
import { Button } from "@norbius/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant={active ? "danger" : "secondary"}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await adminPost(`/api/admin/admins/${id}/active`, { active: !active }).catch(() => {});
        setBusy(false);
        router.refresh();
      }}
    >
      {active ? "Desativar" : "Reativar"}
    </Button>
  );
}
