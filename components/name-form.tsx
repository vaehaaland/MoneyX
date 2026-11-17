"use client";

import { useState, useTransition } from "react";
import { updateDisplayName } from "@/app/(app)/sharing-actions";
import { Button, ErrorText, Field } from "./ui";

/** The name people you share a loan with see instead of your email address. */
export function NameForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await updateDisplayName(name);
          if (result.ok) setSaved(name.trim());
          else setError(result.error);
        });
      }}
    >
      <Field
        label="Namn"
        name="name"
        autoComplete="name"
        maxLength={60}
        value={name}
        onChange={(event) => setName(event.target.value)}
        hint="Blir vist til dei du deler lån med. Utan namn ser dei e-postadressa di."
      />
      <ErrorText>{error}</ErrorText>
      <Button type="submit" variant="tonal" disabled={pending || name.trim() === saved}>
        {pending ? "Lagrar…" : name.trim() === saved && saved ? "Lagra" : "Lagre namn"}
      </Button>
    </form>
  );
}
