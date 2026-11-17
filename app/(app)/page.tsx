import Link from "next/link";
import { Icon } from "@/components/icon";
import { PlanReminder } from "@/components/plan-reminder";
import { buttonClass, Card, TopBar } from "@/components/ui";
import { formatKr, formatMonth, formatRate } from "@/lib/format";
import { balanceLabel } from "@/lib/labels";
import { listLoans, type LoanDetail } from "@/lib/loans";
import { planPayments, upcomingByMonth } from "@/lib/plan";
import { addYears } from "@/lib/projection";
import { dueDatesBetween } from "@/lib/recurring";

export const instant = false;

const LOOKAHEAD_MONTHS = 4;

/**
 * Money planned on a loan after today, capped at what is still owed: payments
 * from the plan being followed, or else the recurring repayments.
 */
function plannedPayments({ activePlan, recurring, upcoming, ledger, today }: LoanDetail) {
  const until = addYears(today, 1);
  const planned = activePlan
    ? planPayments(activePlan.plan, until).filter((p) => p.date > today)
    : recurring
        .filter((rule) => rule.kind === "repayment")
        .flatMap((rule) =>
          dueDatesBetween(rule.nextDue > today ? rule.nextDue : today, rule.endDate && rule.endDate < until ? rule.endDate : until, rule.dayOfMonth)
            .filter((date) => date > today)
            .map((date) => ({ date, amountOre: rule.amountOre })),
        );
  const dated = upcoming.filter((t) => t.kind === "repayment").map((t) => ({ date: t.date, amountOre: t.amountOre }));
  let left = Math.max(ledger.balanceOre, 0);
  return [...planned, ...dated]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((payment) => {
      const amountOre = Math.min(payment.amountOre, left);
      left -= amountOre;
      return amountOre > 0 ? [{ date: payment.date, amountOre }] : [];
    });
}

export default async function LoansPage() {
  const loans = await listLoans();
  const today = loans[0]?.today;
  // Questions the app has for the user, oldest first.
  const reminders = loans
    .filter((detail) => detail.loan.canWrite && detail.activePlan?.status.pending && !detail.activePlan.status.pending.snoozed)
    .sort((a, b) => a.activePlan!.status.pending!.dueDate.localeCompare(b.activePlan!.status.pending!.dueDate));
  // Split by who pays: money going out on loans the user owes on, coming in on the others.
  const outgoing = today ? upcomingByMonth(loans.filter((d) => d.loan.direction === "borrowed").flatMap(plannedPayments), today, LOOKAHEAD_MONTHS) : [];
  const incoming = today ? upcomingByMonth(loans.filter((d) => d.loan.direction === "lent").flatMap(plannedPayments), today, LOOKAHEAD_MONTHS) : [];
  const hasPlanned = [...outgoing, ...incoming].some((bucket) => bucket.amountOre > 0);

  return (
    <>
      <TopBar
        title="Lån"
        actions={
          loans.length > 0 && (
            <Link href="/loans/new" className={buttonClass("tonal", "mr-3 h-10 px-4")}>
              <Icon name="add" className="size-5 -ml-1" />
              Nytt lån
            </Link>
          )
        }
      />
      <div className="animate-enter space-y-3 px-4 pb-10">
        {reminders.map(({ loan, activePlan }) => (
          <PlanReminder
            key={loan.id}
            loan={loan}
            pending={activePlan!.status.pending!}
            showLoanName
            other={
              <Link href={`/loans/${loan.id}`} className={buttonClass("outlined")}>
                Anna beløp
              </Link>
            }
          />
        ))}
        {loans.length === 0 && (
          <Card className="space-y-4 py-12 text-center">
            <h2 className="text-2xl">Få lånet ut av reknearket</h2>
            <p className="mx-auto max-w-sm text-on-surface-variant">
              Opprett lånet, legg inn eller importer det som har skjedd, så held appen saldoen for deg.
            </p>
            <Link href="/loans/new" className={buttonClass("filled")}>
              <Icon name="add" className="size-5 -ml-1" />
              Opprett første lån
            </Link>
          </Card>
        )}
        {loans.map(({ loan, ledger, transactions, people, newCount }) => (
          <Link key={loan.id} href={`/loans/${loan.id}`} className="state-layer block rounded-[28px] bg-surface-low p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-medium">{loan.name}</h2>
                <p className="truncate text-sm text-on-surface-variant">
                  {balanceLabel(loan.direction, loan.counterpartyName, ledger.balanceOre)}
                </p>
              </div>
              {newCount > 0 ? (
                <span className="mt-0.5 shrink-0 rounded-full bg-tertiary-container px-3 py-1 text-sm font-medium text-on-tertiary-container">
                  {newCount} {newCount === 1 ? "ny" : "nye"}
                </span>
              ) : (
                <Icon name="chevron" className="mt-1 size-6 text-on-surface-variant" />
              )}
            </div>
            <p className="mt-4 text-3xl font-medium tracking-tight tabular-nums">
              {formatKr(Math.abs(ledger.balanceOre), { trimZeros: true })}
            </p>
            <p className="mt-1 text-sm text-on-surface-variant">
              {ledger.currentRateBp > 0 ? `${formatRate(ledger.currentRateBp)} rente` : "Rentefritt"} ·{" "}
              {transactions.length} {transactions.length === 1 ? "transaksjon" : "transaksjonar"}
              {people.length > 1 && " · delt"}
            </p>
          </Link>
        ))}

        {hasPlanned && (
          <Card className="px-0 py-2">
            <h2 className="px-5 pt-3 pb-1 text-sm font-medium text-on-surface-variant">Planlagt framover</h2>
            <ul>
              {outgoing.map((bucket, index) => (
                <li key={bucket.month} className="flex items-center gap-4 px-5 py-2.5">
                  <span className="min-w-0 flex-1 capitalize">{formatMonth(`${bucket.month}-01`)}</span>
                  <span className="text-right tabular-nums">
                    {bucket.amountOre > 0 && (
                      <span className="block font-medium">{formatKr(-bucket.amountOre, { trimZeros: true })}</span>
                    )}
                    {incoming[index].amountOre > 0 && (
                      <span className="block font-medium text-primary">
                        {formatKr(incoming[index].amountOre, { trimZeros: true, sign: true })}
                      </span>
                    )}
                    {bucket.amountOre === 0 && incoming[index].amountOre === 0 && (
                      <span className="text-on-surface-variant">–</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="px-5 pt-1 pb-3 text-sm text-on-surface-variant">
              Frå planane du følgjer og faste betalingar. Minus er det du skal betale, pluss er det du skal få.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
