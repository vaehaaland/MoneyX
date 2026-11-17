"use client";

import { useState, useTransition } from "react";
import { acceptInvite } from "@/app/(app)/sharing-actions";
import { Button, ErrorText } from "./ui";

export function AcceptInvite({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            // On success the action redirects to the loan.
            const result = await acceptInvite(token);
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Opnar lånet…" : "Bli med på lånet"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
