"use client";

import { useState, useTransition } from "react";
import { deleteRate, saveRate } from "@/app/(app)/actions";
import { formatDate, formatRate, parseAmountToOre } from "@/lib/format";
import type { LoanRateRow } from "@/lib/loans";
import { Button, Card, ErrorText, Field, IconButton } from "./ui";

export function RatesView({
  loanId,
  rates,
  today,
}: {
  loanId: string;
  rates: LoanRateRow[];
  today: string;
}) {
  const [validFrom, setValidFrom] = useState(today);
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sorted = [...rates].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const current = sorted.find((r) => r.validFrom <= today);

  const add = () => {
    const bp = parseAmountToOre(rate);
    if (bp === null || bp < 0) return setError("Skriv renta som eit tal, t.d. 4,5.");
    setError(null);
    startTransition(async () => {
      const result = await saveRate(loanId, { validFrom, annualRateBp: bp });
      if (result.ok) setRate("");
      else setError(result.error);
    });
  };

  return (
    <div className="animate-enter space-y-4 px-4 pb-10">
      <Card tone="primary" className="p-6">
        <p className="text-sm opacity-80">Gjeldande rente</p>
        <p className="mt-1 text-[2.5rem] leading-tight font-medium tabular-nums">
          {formatRate(current?.annualRateBp ?? 0)}
        </p>
        <p className="mt-2 text-sm opacity-80">
          {current ? `Sidan ${formatDate(current.validFrom)}` : "Lånet er rentefritt"}
        </p>
      </Card>

      <Card>
        <h2 className="pb-3 font-medium">Ny sats</h2>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Rente per år"
              suffix="%"
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
            <Field
              label="Gjeld frå"
              type="date"
              required
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
            />
          </div>
          <p className="text-sm text-on-surface-variant">
            Ein sats tilbake i tid reknar saldoen på nytt frå den datoen. Bruk 0 for ein rentefri periode.
          </p>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Lagrar…" : "Legg til"}
            </Button>
          </div>
        </form>
      </Card>

      {sorted.length > 0 && (
        <Card className="px-0 py-2">
          <h2 className="px-5 pt-3 pb-1 text-sm font-medium text-on-surface-variant">Historikk</h2>
          <ul>
            {sorted.map((item) => (
              <li key={item.id} className="flex items-center gap-4 py-1 pr-2 pl-5">
                <span className="flex-1">
                  <span className="block font-medium tabular-nums">{formatRate(item.annualRateBp)}</span>
                  <span className="block text-sm text-on-surface-variant">
                    Frå {formatDate(item.validFrom)}
                    {item.validFrom > today ? " · kjem" : item.id === current?.id ? " · gjeld no" : ""}
                  </span>
                </span>
                <IconButton
                  icon="delete"
                  label={`Slett sats frå ${formatDate(item.validFrom)}`}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteRate(loanId, item.id);
                      if (!result.ok) setError(result.error);
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
