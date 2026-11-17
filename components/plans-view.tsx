"use client";

import { useMemo, useState, useTransition } from "react";
import { createPlan, deletePlan, setActivePlan } from "@/app/(app)/plan-actions";
import { formatDate, formatKr, formatRate, parseAmountToOre } from "@/lib/format";
import { fromDayNumber, toDayNumber } from "@/lib/loan-engine";
import type { LoanDetail } from "@/lib/loans";
import { simulatePlan, type LoanPlan, type PlanExtra, type PlanResult } from "@/lib/plan";
import { addYears, MAX_YEARS, monthlyForPayoff, plannedTransactions } from "@/lib/projection";
import { BalanceChart } from "./balance-chart";
import { dayLabel } from "./recurring-view";
import { Button, Card, ErrorText, Field, IconButton, Segmented, SelectField } from "./ui";

type Mode = "amount" | "date";
type Draft = Pick<LoanPlan, "monthlyOre" | "dayOfMonth" | "startDate" | "extras" | "assumedRateBp">;

/** "34 betalingar · ferdig 1. sep. 2029", or why the plan never gets there. */
function outcome(result: PlanResult): string {
  if (result.paidOff && result.payoffDate) return `Nedbetalt ${formatDate(result.payoffDate)}`;
  return result.payments === 0 ? "Ingen betalingar framover" : `Ikkje nedbetalt på ${MAX_YEARS} år`;
}

function Figures({ result }: { result: PlanResult }) {
  const items = [
    { label: "Betalingar att", value: result.paidOff ? String(result.payments) : "–" },
    { label: "Totalt å betale", value: result.paidOff ? formatKr(result.totalPaidOre, { trimZeros: true }) : "–" },
    { label: "Av dette renter", value: result.costOre === null ? "–" : formatKr(result.costOre, { trimZeros: true }) },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="truncate text-xs text-on-surface-variant">{item.label}</dt>
          <dd className="truncate font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PlansView({ detail }: { detail: LoanDetail }) {
  const { loan, plans, today, ledger } = detail;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // New plan form
  const [mode, setMode] = useState<Mode>("amount");
  const [amount, setAmount] = useState("");
  const [deadline, setDeadline] = useState(addYears(today, 2));
  const [day, setDay] = useState(Number(today.slice(8, 10)));
  const [startDate, setStartDate] = useState(today);
  const [rate, setRate] = useState("");
  const [extras, setExtras] = useState<PlanExtra[]>([]);
  const [extraDate, setExtraDate] = useState("");
  const [extraAmount, setExtraAmount] = useState("");
  const [activate, setActivate] = useState(!plans.some((plan) => plan.isActive));
  const [formError, setFormError] = useState<string | null>(null);

  const results = useMemo(() => new Map(plans.map((plan) => [plan.id, simulatePlan(detail, plan)])), [detail, plans]);
  const selected = plans.find((plan) => plan.id === selectedId) ?? plans.find((plan) => plan.isActive) ?? plans[0] ?? null;
  const settled = ledger.balanceOre <= 0;

  // The plan being typed in, simulated as you type.
  const rateBp = rate.trim() === "" ? null : parseAmountToOre(rate);
  const validDates = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && (mode === "amount" || /^\d{4}-\d{2}-\d{2}$/.test(deadline));
  const draft = useMemo((): Draft | null => {
    if (!validDates || (rateBp !== null && rateBp < 0)) return null;
    let monthlyOre: number | null;
    if (mode === "amount") {
      monthlyOre = amount.trim() === "" ? (extras.length > 0 ? 0 : null) : parseAmountToOre(amount);
    } else {
      // Monthly payments begin on the first due date from the start date.
      const after = startDate > today ? fromDayNumber(toDayNumber(startDate) - 1) : today;
      const base = [
        ...plannedTransactions(detail, addYears(today, MAX_YEARS), false),
        ...extras.map((extra) => ({ date: extra.date, amountOre: extra.amountOre, kind: "repayment" as const })),
      ];
      monthlyOre = deadline > after ? monthlyForPayoff(detail, base, after, deadline, day, rateBp ?? undefined) : null;
    }
    if (monthlyOre === null || monthlyOre < 0) return null;
    return { monthlyOre, dayOfMonth: day, startDate, extras, assumedRateBp: rateBp };
  }, [amount, day, deadline, detail, extras, mode, rateBp, startDate, today, validDates]);
  const preview = useMemo(() => (draft ? simulatePlan(detail, draft) : null), [detail, draft]);

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error);
    });

  const addExtra = () => {
    const amountOre = parseAmountToOre(extraAmount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(extraDate) || extraDate <= today) return setFormError("Vel ein dato fram i tid for den ekstra innbetalinga.");
    if (amountOre === null || amountOre <= 0) return setFormError("Skriv inn beløpet for den ekstra innbetalinga.");
    setFormError(null);
    setExtras([...extras, { date: extraDate, amountOre }].sort((a, b) => a.date.localeCompare(b.date)));
    setExtraDate("");
    setExtraAmount("");
  };

  const save = () => {
    if (!draft) {
      return setFormError(
        mode === "amount" ? "Skriv inn eit beløp per månad." : "Ingen betaling fell før måldatoen. Vel ein seinare dato.",
      );
    }
    setFormError(null);
    startTransition(async () => {
      const name = draft.monthlyOre > 0 ? `${formatKr(draft.monthlyOre, { trimZeros: true })} i månaden` : "Eingongsbetalingar";
      const result = await createPlan(loan.id, { ...draft, name, activate });
      if (result.ok) {
        setAmount("");
        setExtras([]);
        setActivate(false);
      } else setFormError(result.error);
    });
  };

  return (
    <div className="animate-enter space-y-4 px-4 pb-10">
      {settled && (
        <Card>
          <p className="text-on-surface-variant">Lånet er gjort opp, så det er ingenting å planleggje.</p>
        </Card>
      )}

      {selected && results.get(selected.id) && !settled && (
        <Card className="px-3 pt-5 pb-3">
          <h2 className="px-2 pb-1 text-sm font-medium text-on-surface-variant">
            {selected.name} · {outcome(results.get(selected.id)!)}
          </h2>
          <BalanceChart series={ledger.series} projection={results.get(selected.id)!.series} />
          <p className="px-2 pt-2 text-xs text-on-surface-variant">
            Heil linje er det som har skjedd. Stipla linje er planen, rekna frå saldoen i dag.
          </p>
        </Card>
      )}

      {plans.length > 0 && (
        <section aria-label="Planar" className="space-y-3">
          {plans.length > 1 && (
            <h2 className="px-2 text-sm font-medium text-on-surface-variant">Samanlikn planane</h2>
          )}
          {plans.map((plan) => {
            const result = results.get(plan.id)!;
            const isSelected = selected?.id === plan.id;
            return (
              <Card key={plan.id} className={`space-y-4 ${isSelected ? "ring-2 ring-primary" : ""}`}>
                <button type="button" className="block w-full text-left" onClick={() => setSelectedId(plan.id)}>
                  <span className="flex items-center gap-2">
                    <span className="truncate text-lg font-medium">{plan.name}</span>
                    {plan.isActive && (
                      <span className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-on-primary">
                        Aktiv
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-on-surface-variant">
                    {plan.monthlyOre > 0 ? `Den ${plan.dayOfMonth}. kvar månad frå ${formatDate(plan.startDate)}` : "Ingen fast månadsbetaling"}
                    {plan.extras.length > 0 && ` · ${plan.extras.length} ekstra`}
                    {plan.assumedRateBp !== null && ` · rekna med ${formatRate(plan.assumedRateBp)} rente`}
                  </span>
                  <span className="mt-3 block text-xl font-medium tabular-nums">{outcome(result)}</span>
                </button>
                <Figures result={result} />
                {loan.canWrite && (
                  <div className="flex flex-wrap items-center gap-2">
                    {plan.isActive ? (
                      <Button variant="outlined" disabled={pending} onClick={() => run(() => setActivePlan(loan.id, null))}>
                        Slutt å følgje
                      </Button>
                    ) : (
                      <Button variant="tonal" disabled={pending} onClick={() => run(() => setActivePlan(loan.id, plan.id))}>
                        Følg denne planen
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`Slette planen «${plan.name}»?`)) run(() => deletePlan(loan.id, plan.id));
                      }}
                    >
                      Slett
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
          <p className="px-2 text-sm text-on-surface-variant">
            Planen du følgjer blir appen sitt utgangspunkt: han spør om kvar betaling er gjort, og viser om du ligg
            føre eller bak. Ein plan fører aldri noko av seg sjølv.
          </p>
        </section>
      )}
      <ErrorText>{error}</ErrorText>

      {loan.canWrite && !settled && (
        <Card>
          <h2 className="pb-1 font-medium">{plans.length === 0 ? "Lag ein plan" : "Ny plan"}</h2>
          <p className="pb-4 text-sm text-on-surface-variant">
            Prøv eit beløp, eller la appen rekne ut kva som skal til for å vere ferdig til ein dato. Du ser
            resultatet før du lagrar.
          </p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Segmented<Mode>
              label="Utgangspunkt"
              value={mode}
              onChange={setMode}
              options={[
                { value: "amount", label: "Fast beløp" },
                { value: "date", label: "Ferdig innan" },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {mode === "amount" ? (
                <Field
                  label="Beløp per månad"
                  suffix="kr"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              ) : (
                <Field
                  label="Ferdig innan"
                  type="date"
                  min={today}
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              )}
              <SelectField label="Dag i månaden" value={day} onChange={(event) => setDay(Number(event.target.value))}>
                {Array.from({ length: 31 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {dayLabel(value)}
                  </option>
                ))}
              </SelectField>
              <Field
                label="Første betaling frå"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
              <Field
                label="Rekn med rente (valfritt)"
                suffix="%"
                inputMode="decimal"
                autoComplete="off"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                hint={`Tom: bruk lånet si eiga rente (${formatRate(ledger.currentRateBp)} no).`}
              />
            </div>

            <fieldset className="space-y-3 rounded-3xl border border-outline-variant p-4">
              <legend className="px-2 text-sm text-on-surface-variant">Ekstra innbetalingar (valfritt)</legend>
              {extras.length > 0 && (
                <ul>
                  {extras.map((extra, index) => (
                    <li key={`${extra.date}-${index}`} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 tabular-nums">
                        {formatKr(extra.amountOre, { trimZeros: true })}{" "}
                        <span className="text-on-surface-variant">{formatDate(extra.date)}</span>
                      </span>
                      <IconButton
                        icon="close"
                        label="Fjern ekstra innbetaling"
                        onClick={() => setExtras(extras.filter((_, i) => i !== index))}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Field
                  label="Beløp"
                  suffix="kr"
                  inputMode="decimal"
                  autoComplete="off"
                  value={extraAmount}
                  onChange={(event) => setExtraAmount(event.target.value)}
                />
                <Field label="Dato" type="date" min={today} value={extraDate} onChange={(event) => setExtraDate(event.target.value)} />
                <Button variant="tonal" onClick={addExtra}>
                  Legg til
                </Button>
              </div>
            </fieldset>

            {draft && preview && (
              <div role="status" className="space-y-3 rounded-3xl bg-primary-container p-4 text-on-primary-container">
                <p className="text-sm opacity-80">
                  {mode === "date" && draft.monthlyOre > 0
                    ? `Det krev ${formatKr(draft.monthlyOre, { trimZeros: true })} i månaden`
                    : "Med denne planen"}
                </p>
                <p className="text-xl font-medium tabular-nums">{outcome(preview)}</p>
                {preview.paidOff && (
                  <p className="text-sm">
                    {preview.payments} betalingar, totalt {formatKr(preview.totalPaidOre, { trimZeros: true })}
                    {preview.costOre !== null && preview.costOre > 0
                      ? `, av dette ${formatKr(preview.costOre, { trimZeros: true })} i renter`
                      : ""}
                    .
                  </p>
                )}
              </div>
            )}

            <label className="flex items-center gap-3 py-1">
              <input
                type="checkbox"
                checked={activate}
                onChange={(event) => setActivate(event.target.checked)}
                className="size-5 accent-[var(--md-primary)]"
              />
              <span>Følg denne planen</span>
            </label>
            <ErrorText>{formError}</ErrorText>
            <Button type="submit" disabled={pending}>
              {pending ? "Lagrar…" : "Lagre plan"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
