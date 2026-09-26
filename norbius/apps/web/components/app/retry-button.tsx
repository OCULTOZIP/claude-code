"use client";
import { Button } from "@norbius/ui";

export function RetryButton() {
  return (
    <Button className="mt-8" onClick={() => location.reload()}>
      Tentar de novo
    </Button>
  );
}
