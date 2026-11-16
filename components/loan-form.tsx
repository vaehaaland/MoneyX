"use client";

import { useState, useTransition } from "react";
import { createLoan, deleteLoan, updateLoan } from "@/app/(app)/actions";
import { parseAmountToOre } from "@/lib/format";
import { CAPITALIZATION_LABELS } from "@/lib/labels";
import type { Capitalization } from "@/lib/loan-engine";
import type { Loan } from "@/lib/loans";
import { Button, ErrorText, Field, Segmented, SelectField } from "./ui";

/** Create a loan, or edit one when `loan` is given. */
export function LoanForm({ loan, today }: { loan?: Loan; today: string }) {
  const [name, setName] = useState(loan?.name ?? "");
  const [counterparty, setCounterparty] = useState(loan?.counterpartyName ?? "");
  const [direction, setDirection] = useState<Loan["direction"]>(loan?.direction ?? "borrowed");
  const [startDate, setStartDate] = useState(loan?.startDate ?? today);
  const [rate, setRate] = useState("0");
  const [capitalization, setCapitalization] = useState<Capitalization>(loan?.capitalization ?? "none");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const rateOre = parseAmountToOre(rate); // percent × 100 = basis points
  const showCapitalization = Boolean(loan) || (rateOre ?? 0) > 0;

  const submit = () => {
    if (!loan && (rateOre === null || rateOre < 0)) return setError("Skriv renta som eit tal, t.d. 4,5.");
    setError(null);
    setSaved(false);
    const base = { name, counterpartyName: counterparty, direction, startDate, capitalization };
    startTransition(async () => {
      const result = loan
        ? await updateLoan(loan.id, base)
        : await createLoan({ ...base, annualRateBp: rateOre ?? 0 });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Segmented<Loan["direction"]>
        label="Kven skuldar"
        value={direction}
        onChange={setDirection}
        options={[
          { value: "borrowed", label: "Eg har lånt" },
          { value: "lent", label: "Eg har lånt ut" },
        ]}
      />
      <Field
        label="Namn på lånet"
        required
        maxLength={120}
        value={name}
        onChange={(event) => setName(event.target.value)}
        hint="T.d. «Lån til bustad» eller «Billån»."
      />
      <Field
        label={direction === "borrowed" ? "Kven har du lånt av? (valfritt)" : "Kven har lånt? (valfritt)"}
        maxLength={120}
        value={counterparty}
        onChange={(event) => setCounterparty(event.target.value)}
      />
      <Field
        label="Startdato"
        type="date"
        required
        value={startDate}
        onChange={(event) => setStartDate(event.target.value)}
      />
      {!loan && (
        <Field
          label="Rente per år"
          suffix="%"
          inputMode="decimal"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          hint="La stå på 0 for rentefritt. Kan endrast seinare."
        />
      )}
      {showCapitalization && (
        <SelectField
          label="Påløpte renter"
          value={capitalization}
          onChange={(event) => setCapitalization(event.target.value as Capitalization)}
          hint="Har berre noko å seie når lånet har rente."
        >
          {(Object.keys(CAPITALIZATION_LABELS) as Capitalization[]).map((value) => (
            <option key={value} value={value}>
              {CAPITALIZATION_LABELS[value]}
            </option>
          ))}
        </SelectField>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex items-center gap-3 pt-2">
        {saved && <span className="text-sm text-primary" role="status">Lagra</span>}
        <Button type="submit" disabled={pending} className="ml-auto min-w-32">
          {pending ? "Lagrar…" : loan ? "Lagre" : "Opprett lån"}
        </Button>
      </div>

      {loan?.isOwner && (
        <div className="mt-8 rounded-[28px] border border-outline-variant p-5">
          <h2 className="font-medium">Slett lånet</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Slettar lånet og alle transaksjonar og rentesatsar. Kan ikkje angrast.
          </p>
          <div className="mt-3 flex gap-2">
            {confirmDelete ? (
              <>
                <Button
                  variant="danger"
                  icon="delete"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteLoan(loan.id);
                      if (!result.ok) setError(result.error);
                    })
                  }
                >
                  Ja, slett alt
                </Button>
                <Button variant="text" onClick={() => setConfirmDelete(false)}>
                  Avbryt
                </Button>
              </>
            ) : (
              <Button variant="danger" icon="delete" onClick={() => setConfirmDelete(true)}>
                Slett lånet
              </Button>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
