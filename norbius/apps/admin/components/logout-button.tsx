"use client";
import { adminPost } from "@/lib/client";
import { Button } from "@norbius/ui";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      size="sm"
      className="mt-3 w-full"
      onClick={async () => {
        await adminPost("/api/admin/auth/logout", {}).catch(() => {});
        router.replace("/entrar");
      }}
    >
      Sair
    </Button>
  );
}
