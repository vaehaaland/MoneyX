"use client";

import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, ErrorText, Field } from "@/components/ui";
import { sendCode, verifyCode } from "./actions";

export function LoginForm() {
  const searchParams = useSearchParams();
  const linkFailed = searchParams.get("error") === "link";
  // Where the visitor was headed before being asked to sign in, e.g. an invite link.
  const next = searchParams.get("next") ?? undefined;
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(
    linkFailed ? "Lenka er utgått eller alt brukt. Be om ei ny." : null,
  );
  const [pending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      setError(null);
      const result = await sendCode(email, next);
      if (result.ok) setStep("code");
      else setError(result.error);
    });

  const verify = () =>
    startTransition(async () => {
      setError(null);
      const result = await verifyCode(email, code, next);
      if (!result.ok) setError(result.error);
    });

  if (step === "email") {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Field
          label="E-post"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          hint="Du får ei innloggingslenke på e-post. Ingen passord."
        />
        {next?.startsWith("/invite/") && (
          <p className="rounded-2xl bg-secondary-container px-4 py-3 text-sm text-on-secondary-container">
            Du er invitert til eit lån. Logg inn, så kjem du rett til invitasjonen.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Sender…" : "Send innlogging"}
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        verify();
      }}
    >
      <div className="rounded-[28px] bg-surface-low p-5">
        <h2 className="text-lg font-medium">Sjekk e-posten</h2>
        <p className="mt-1 text-on-surface-variant">
          Me har sendt ei lenke til <span className="break-all text-on-surface">{email}</span>. Opne ho i
          denne nettlesaren, så er du inne.
        </p>
      </div>
      <details className="group rounded-[28px] bg-surface-low p-5">
        <summary className="cursor-pointer list-none font-medium text-primary">
          Fekk du ein kode i e-posten?
        </summary>
        <div className="mt-4 space-y-4">
          <Field
            label="Kode"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
          <Button type="submit" disabled={pending || code.length < 6} className="w-full">
            {pending ? "Loggar inn…" : "Logg inn med kode"}
          </Button>
        </div>
      </details>
      <ErrorText>{error}</ErrorText>
      <Button
        variant="text"
        disabled={pending}
        className="w-full"
        onClick={() => {
          setStep("email");
          setCode("");
          setError(null);
        }}
      >
        Bruk ei anna adresse
      </Button>
    </form>
  );
}
