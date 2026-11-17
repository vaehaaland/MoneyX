"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { markLoanSeen } from "@/app/(app)/sharing-actions";
import { formatDate, formatKr, formatRate } from "@/lib/format";
import { balanceLabel, CAPITALIZATION_LABELS, ENTRY_ICONS, ENTRY_LABELS } from "@/lib/labels";
import type { LedgerEntryType } from "@/lib/loan-engine";
import type { LoanDetail, LoanTransactionRow } from "@/lib/loans";
import { simulatePlan } from "@/lib/plan";
import { BalanceChart } from "./balance-chart";
import { Icon } from "./icon";
import { PlanReminder } from "./plan-reminder";
import { TransactionSheet } from "./transaction-sheet";
import { Button, buttonClass, Card, Fab } from "./ui";

interface Row {
  key: string;
  date: string;
  type: LedgerEntryType;
  title: string;
  detail: string | null;
  /** Signed effect on the balance; null when nothing moved (rate change). */
  deltaOre: number | null;
  balanceAfterOre: number | null;
  transaction: LoanTransactionRow | null;
  /** Added by the other party since the last visit. */
  isNew: boolean;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-3xl bg-surface-low px-4 py-3">
      <div className="truncate text-xs text-on-surface-variant">{label}</div>
      <div className="truncate text-base font-medium tabular-nums">{value}</div>
    </div>
  );
}

function TimelineRow({ row, onEdit }: { row: Row; onEdit: ((tx: LoanTransactionRow) => void) | null }) {
  const reduces = row.deltaOre !== null && row.deltaOre < 0;
  const content = (
    <>
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
          reduces
            ? "bg-primary-container text-on-primary-container"
            : row.transaction
              ? "bg-tertiary-container text-on-tertiary-container"
              : "bg-surface-highest text-on-surface-variant"
        }`}
      >
        <Icon name={ENTRY_ICONS[row.type]} className="size-5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="truncate">{row.title}</span>
          {row.isNew && (
            <span className="shrink-0 rounded-full bg-tertiary-container px-2 py-0.5 text-xs font-medium text-on-tertiary-container">
              Ny
            </span>
          )}
        </span>
        <span className="line-clamp-2 text-sm text-on-surface-variant">
          {formatDate(row.date)}
          {row.detail ? ` · ${row.detail}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        {row.deltaOre !== null && (
          <span className={`block font-medium ${reduces ? "text-primary" : ""}`}>
            {formatKr(row.deltaOre, { sign: true, trimZeros: true })}
          </span>
        )}
        {row.balanceAfterOre !== null && (
          <span className="block text-sm text-on-surface-variant">
            {formatKr(row.balanceAfterOre, { trimZeros: true })}
          </span>
        )}
      </span>
    </>
  );
  const className = "flex w-full items-center gap-4 px-4 py-3";
  return (
    <li>
      {row.transaction && onEdit ? (
        <button
          type="button"
          className={`state-layer ${className}`}
          onClick={() => onEdit(row.transaction!)}
          aria-label={`${row.title}, ${formatDate(row.date)}. Endre`}
        >
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

export function LoanView({ detail }: { detail: LoanDetail }) {
  const { loan, ledger, transactions, upcoming, recurring, today, people, newCount, activePlan } = detail;
  // Where the plan being followed leads from today's balance.
  const planResult = useMemo(() => (activePlan ? simulatePlan(detail, activePlan.plan) : null), [detail, activePlan]);
  const planPending = activePlan?.status.pending;
  const shared = people.length > 1;
  const activeRecurring = recurring.filter((rule) => rule.endDate === null || rule.nextDue <= rule.endDate);
  const [sheet, setSheet] = useState<{ open: boolean; editing: LoanTransactionRow | null }>({
    open: false,
    editing: null,
  });

  // Opening the loan is what marks the other party's entries as seen.
  useEffect(() => {
    void markLoanSeen(loan.id);
  }, [loan.id]);

  const byId = new Map(transactions.map((t) => [t.id, t]));
  const rows: Row[] = ledger.entries
    .map((entry, index): Row => {
      const transaction = entry.transactionId ? (byId.get(entry.transactionId) ?? null) : null;
      let detailText = entry.note ?? null;
      let deltaOre: number | null = entry.deltaOre;
      if (entry.type === "rate_change") {
        detailText = formatRate(entry.annualRateBp ?? 0);
        deltaOre = null;
      } else if (entry.type === "capitalization") {
        deltaOre = entry.interestPartOre;
      } else if (entry.type === "repayment" && entry.interestPartOre > 0) {
        const split = `${formatKr(entry.interestPartOre, { trimZeros: true })} renter`;
        detailText = detailText ? `${detailText} · ${split}` : split;
      }
      if (transaction?.recurring) detailText = detailText ? `Fast · ${detailText}` : "Fast betaling";
      if (transaction?.addedBy) detailText = [detailText, `Ført av ${transaction.addedBy}`].filter(Boolean).join(" · ");
      return {
        key: entry.transactionId ?? `${entry.type}-${entry.date}-${index}`,
        date: entry.date,
        type: entry.type,
        title: ENTRY_LABELS[entry.type],
        detail: detailText,
        deltaOre,
        balanceAfterOre: entry.type === "rate_change" ? null : entry.balanceAfterOre,
        transaction,
        isNew: transaction?.isNew ?? false,
      };
    })
    .reverse();

  const upcomingRows: Row[] = upcoming.map((t) => ({
    key: t.id,
    date: t.date,
    type: t.kind,
    title: ENTRY_LABELS[t.kind],
    detail: [t.note, t.addedBy ? `Ført av ${t.addedBy}` : null].filter(Boolean).join(" · ") || null,
    deltaOre: t.kind === "repayment" ? -t.amountOre : t.amountOre,
    balanceAfterOre: null,
    transaction: t,
    isNew: t.isNew,
  }));

  const hasInterest = ledger.currentRateBp > 0 || ledger.totals.paidInterestOre > 0 ||
    ledger.totals.capitalizedInterestOre > 0 || ledger.accruedInterestOre > 0;
  const empty = transactions.length === 0;
  // Viewers get a read-only timeline.
  const edit = loan.canWrite ? (tx: LoanTransactionRow) => setSheet({ open: true, editing: tx }) : null;
  const others = people.filter((p) => !p.isMe);

  return (
    <div className="animate-enter space-y-4 px-4 pb-28">
      <Card tone="primary" className="p-6">
        <p className="text-sm opacity-80">
          {balanceLabel(loan.direction, loan.counterpartyName, ledger.balanceOre)}
        </p>
        <p className="mt-1 text-[2.5rem] leading-tight font-medium tracking-tight tabular-nums">
          {formatKr(Math.abs(ledger.balanceOre), { trimZeros: true })}
        </p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm opacity-80">
          <span>{ledger.currentRateBp > 0 ? `${formatRate(ledger.currentRateBp)} rente` : "Rentefritt"}</span>
          {ledger.accruedInterestOre > 0 && (
            <span>Av dette {formatKr(ledger.accruedInterestOre)} i påløpte renter</span>
          )}
        </p>
      </Card>

      {loan.canWrite && planPending && !planPending.snoozed && (
        <PlanReminder
          loan={loan}
          pending={planPending}
          other={
            <Button variant="outlined" onClick={() => setSheet({ open: true, editing: null })}>
              Anna beløp
            </Button>
          }
        />
      )}

      {newCount > 0 && (
        <p role="status" className="rounded-3xl bg-tertiary-container px-5 py-3 text-sm text-on-tertiary-container">
          {newCount === 1 ? "Éin ny transaksjon" : `${newCount} nye transaksjonar`} sidan sist du var innom.
        </p>
      )}

      {!empty && (
        <div className={`grid gap-3 ${hasInterest ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
          <Stat label="Lånt totalt" value={formatKr(ledger.totals.disbursedOre, { trimZeros: true })} />
          <Stat label="Betalt tilbake" value={formatKr(ledger.totals.repaidOre, { trimZeros: true })} />
          {hasInterest && (
            <Stat
              label="Renter betalt"
              value={formatKr(ledger.totals.paidInterestOre, { trimZeros: true })}
            />
          )}
        </div>
      )}

      {ledger.entries.length > 1 && (
        <Card className="px-3 pt-5 pb-3">
          <h2 className="px-2 pb-3 text-sm font-medium text-on-surface-variant">Saldo over tid</h2>
          <BalanceChart series={ledger.series} projection={planResult?.series} />
        </Card>
      )}

      <Link
        href={`/loans/${loan.id}/plan`}
        className="state-layer flex items-center gap-4 rounded-[28px] bg-surface-low px-5 py-4"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
          <Icon name="trend" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block">Nedbetalingsplan</span>
          <span className="block text-sm text-on-surface-variant">
            {activePlan && planResult
              ? [
                  activePlan.plan.name,
                  planResult.payoffDate ? `nedbetalt ${formatDate(planResult.payoffDate)}` : null,
                  activePlan.status.aheadOre > 0
                    ? `${formatKr(activePlan.status.aheadOre, { trimZeros: true })} føre planen`
                    : activePlan.status.aheadOre < 0
                      ? `${formatKr(-activePlan.status.aheadOre, { trimZeros: true })} bak planen`
                      : "i rute",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : detail.plans.length > 0
                ? "Ingen plan blir følgd. Vel éin for å få påminningar."
                : "Sjå når lånet er nedbetalt med ulike beløp"}
          </span>
        </span>
        <Icon name="chevron" className="size-6 text-on-surface-variant" />
      </Link>

      <Link
        href={`/loans/${loan.id}/share`}
        className="state-layer flex items-center gap-4 rounded-[28px] bg-surface-low px-5 py-4"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
          <Icon name="group" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block">{shared ? "Delt lån" : "Del lånet"}</span>
          <span className="block truncate text-sm text-on-surface-variant">
            {shared
              ? `Med ${others.map((p) => p.name).join(", ")}${loan.canWrite ? "" : " · du kan berre sjå"}`
              : "Inviter den andre parten, så held de lånet oppdatert saman"}
          </span>
        </span>
        <Icon name="chevron" className="size-6 text-on-surface-variant" />
      </Link>

      <Link
        href={`/loans/${loan.id}/recurring`}
        className="state-layer flex items-center gap-4 rounded-[28px] bg-surface-low px-5 py-4"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
          <Icon name="repeat" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block">Faste betalingar</span>
          <span className="block truncate text-sm text-on-surface-variant">
            {activeRecurring.length === 0
              ? "Få faste innbetalingar ført automatisk"
              : activeRecurring
                  .map((rule) => `${formatKr(rule.amountOre, { trimZeros: true })} den ${rule.dayOfMonth}.`)
                  .join(" · ") +
                ` · neste ${formatDate([...activeRecurring].sort((a, b) => a.nextDue.localeCompare(b.nextDue))[0].nextDue)}`}
          </span>
        </span>
        <Icon name="chevron" className="size-6 text-on-surface-variant" />
      </Link>

      {empty ? (
        <Card className="space-y-4 py-10 text-center">
          <h2 className="text-xl">Ingen transaksjonar enno</h2>
          <p className="mx-auto max-w-sm text-on-surface-variant">
            {loan.canWrite
              ? "Legg inn det første uttaket, eller hent heile historikken frå reknearket ditt."
              : "Her dukkar transaksjonane opp når dei blir lagde inn."}
          </p>
          <div className={`flex flex-wrap justify-center gap-3 ${loan.canWrite ? "" : "hidden"}`}>
            <Link href={`/loans/${loan.id}/import`} className={buttonClass("tonal")}>
              <Icon name="upload" className="size-5 -ml-1" />
              Importer frå Excel
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {upcomingRows.length > 0 && (
            <Card className="px-0 py-2">
              <h2 className="px-5 pt-3 pb-1 text-sm font-medium text-on-surface-variant">
                Fram i tid · ikkje med i saldoen
              </h2>
              <ul>
                {upcomingRows.map((row) => (
                  <TimelineRow key={row.key} row={row} onEdit={edit} />
                ))}
              </ul>
            </Card>
          )}
          <Card className="px-0 py-2">
            <h2 className="px-5 pt-3 pb-1 text-sm font-medium text-on-surface-variant">Tidslinje</h2>
            <ul>
              {rows.map((row) => (
                <TimelineRow key={row.key} row={row} onEdit={edit} />
              ))}
            </ul>
          </Card>
          {hasInterest && (
            <p className="px-2 text-sm text-on-surface-variant">
              {loan.capitalization === "none"
                ? "Påløpte renter står for seg sjølv og blir ikkje lagt til lånet."
                : `Påløpte renter ${CAPITALIZATION_LABELS[loan.capitalization].toLowerCase()}.`}
            </p>
          )}
        </>
      )}

      {loan.canWrite && (
        <>
          <Fab icon="add" onClick={() => setSheet({ open: true, editing: null })}>
            Ny transaksjon
          </Fab>
          <TransactionSheet
            open={sheet.open}
            onClose={() => setSheet((current) => ({ ...current, open: false }))}
            loanId={loan.id}
            editing={sheet.editing}
            defaultKind={empty ? "disbursement" : "repayment"}
            today={today}
          />
        </>
      )}
    </div>
  );
}
