"use client";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Button } from "@norbius/ui";
import { useState } from "react";

export function GoogleButton({ next, onError }: { next: string; onError: (message: string) => void }) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="secondary"
      className="w-full"
      loading={loading}
      onClick={async () => {
        setLoading(true);
        const { error } = await authClient.signIn.social({
          provider: "google",
          callbackURL: next,
          errorCallbackURL: "/entrar?erro=google",
        });
        if (error) {
          setLoading(false);
          onError(authErrorMessage(error));
        }
      }}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-4">
        <path fill="#fff" d="M21.35 11.1H12v2.98h5.35c-.23 1.5-1.72 4.4-5.35 4.4-3.22 0-5.85-2.67-5.85-5.96S8.78 6.56 12 6.56c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.7 4.03 14.56 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.59-.06-1.04-.29-1.1Z" />
      </svg>
      Continuar com Google
    </Button>
  );
}
