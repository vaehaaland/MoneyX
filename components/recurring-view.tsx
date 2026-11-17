"use client";

import { useState, useTransition } from "react";
import { createRecurring, deleteRecurring } from "@/app/(app)/actions";
import { formatDate, formatKr, parseAmountToOre } from "@/lib/format";
import type { RecurringPaymentRow } from "@/lib/loans";
import { dueDatesBetween, firstDueOnOrAfter } from "@/lib/recurring";
import { Button, Card, ErrorText, Field, IconButton, Segmented, SelectField } from "./ui";

export function dayLabel(day: number): string {
  return day >= 29 ? `Den ${day}. (eller siste dag i månaden)` : `Den ${day}.`;
}

export function isFinished(rule: RecurringPaymentRow): boolean {
  return rule.endDate !== null && rule.nextDue > rule.endDate;
}

export function RecurringView({
  loanId,
  rules,
  today,
}: {
  loanId: string;
  rules: RecurringPaymentRow[];
  today: string;
}) {
  const [kind, setKind] = useState<RecurringPaymentRow["kind"]>("repayment");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(Number(today.slice(8, 10)));
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(startDate);
  const backfill = validStart ? dueDatesBetween(startDate, endDate && endDate < today ? endDate : today, day) : [];
  const firstDue = validStart ? firstDueOnOrAfter(startDate, day) : null;

  const add = () => {
    const amountOre = parseAmountToOre(amount);
    if (amountOre === null || amountOre <= 0) return setError("Skriv inn eit beløp.");
    setError(null);
    startTransition(async () => {
      const result = await createRecurring(loanId, {
        kind,
        amountOre,
        dayOfMonth: day,
        startDate,
        endDate: endDate || null,
        note,
      });
      if (result.ok) {
        setAmount("");
        setNote("");
      } else setError(result.error);
    });
  };

  return (
    <div className="animate-enter space-y-4 px-4 pb-10">
      {rules.length > 0 && (
        <Card className="px-0 py-2">
          <h2 className="px-5 pt-3 pb-1 text-sm font-medium text-on-surface-variant">Aktive</h2>
          <ul>
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-4 py-2 pr-2 pl-5">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium tabular-nums">
                    {formatKr(rule.amountOre, { trimZeros: true })}{" "}
                    <span className="font-normal text-on-surface-variant">
                      {rule.kind === "repayment" ? "innbetaling" : "uttak"} den {rule.dayOfMonth}. kvar månad
                    </span>
                  </span>
                  <span className="block truncate text-sm text-on-surface-variant">
                    {isFinished(rule)
                      ? `Avslutta ${formatDate(rule.endDate!)}`
                      : `Neste: ${formatDate(rule.nextDue)}${rule.endDate ? ` · til ${formatDate(rule.endDate)}` : ""}`}
                    {rule.note ? ` · ${rule.note}` : ""}
                  </span>
                </span>
                <IconButton
                  icon="delete"
                  label="Stopp fast betaling"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteRecurring(loanId, rule.id);
                      if (!result.ok) setError(result.error);
                    })
                  }
                />
              </li>
            ))}
          </ul>
          <p className="px-5 pt-1 pb-3 text-sm text-on-surface-variant">
            Å stoppe ei fast betaling fjernar ikkje det som alt er ført.
          </p>
        </Card>
      )}

      <Card>
        <h2 className="pb-1 font-medium">Ny fast betaling</h2>
        <p className="pb-4 text-sm text-on-surface-variant">
          Blir ført som ein vanleg transaksjon natta til forfallsdagen. Du kan endre eller slette kvar enkelt
          etterpå.
        </p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Segmented<RecurringPaymentRow["kind"]>
            label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "repayment", label: "Innbetaling" },
              { value: "disbursement", label: "Uttak" },
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Beløp"
              suffix="kr"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <SelectField label="Dag i månaden" value={day} onChange={(event) => setDay(Number(event.target.value))}>
              {Array.from({ length: 31 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {dayLabel(value)}
                </option>
              ))}
            </SelectField>
            <Field
              label="Frå og med"
              type="date"
              required
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            <Field
              label="Til og med (valfritt)"
              type="date"
              min={startDate}
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          <Field
            label="Notat (valfritt)"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {backfill.length > 0 ? (
            <p className="rounded-2xl bg-tertiary-container px-4 py-3 text-sm text-on-tertiary-container">
              {backfill.length === 1
                ? `Éi betaling (${formatDate(backfill[0])}) har alt forfalle og blir ført med ein gong.`
                : `${backfill.length} betalingar frå ${formatDate(backfill[0])} til ${formatDate(backfill.at(-1)!)} har alt forfalle og blir førte med ein gong.`}
            </p>
          ) : (
            firstDue && (
              <p className="px-1 text-sm text-on-surface-variant">Første betaling blir ført {formatDate(firstDue)}.</p>
            )
          )}
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Lagrar…" : "Legg til"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
