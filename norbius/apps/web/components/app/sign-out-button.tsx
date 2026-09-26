"use client";
import { authClient } from "@/lib/auth-client";
import { Button } from "@norbius/ui";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      loading={loading}
      aria-label={compact ? "Sair" : undefined}
      onClick={async () => {
        setLoading(true);
        await authClient.signOut();
        router.replace("/entrar");
        router.refresh();
      }}
    >
      {loading ? null : <LogOut aria-hidden className="size-4" />}
      {compact ? null : "Sair"}
    </Button>
  );
}
