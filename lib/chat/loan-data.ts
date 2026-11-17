/**
 * Shapes loan data for the chat tools. Pure: everything is derived from a
 * `LoanDetail` through the loan engine, so the chat reports the same numbers
 * as the screens. Amounts leave here as kroner (øre / 100) because that is
 * the unit the model talks to the user in.
 */
import { formatRate } from "../format";
import { balanceLabel } from "../labels";
import type { LedgerEntryType, LoanTransaction } from "../loan-engine";
import type { LoanDetail } from "../loans";
import { addYears, firstDueAfter, MAX_YEARS, monthlyForPayoff, monthlyRepayments, plannedTransactions, project } from "../projection";

const kr = (ore: number) => ore / 100;
const toOre = (kroner: number) => Math.round(kroner * 100);

// ── Summaries ───────────────────────────────────────────────────────────────

/** One line per loan for `list_loans`. */
export function loanOverview(detail: LoanDetail) {
  const { loan, ledger } = detail;
  return {
    loan_id: loan.id,
    name: loan.name,
    counterparty: loan.counterpartyName,
    position: balanceLabel(loan.direction, loan.counterpartyName, ledger.balanceOre),
    balance_kr: kr(ledger.balanceOre),
    annual_rate: formatRate(ledger.currentRateBp),
    archived: loan.archivedAt !== null,
    your_access: loan.role,
    shared_with: detail.people.filter((p) => !p.isMe).map((p) => p.name),
  };
}

/** Full current position for `get_loan`. */
export function loanSummary(detail: LoanDetail) {
  const { loan, ledger, transactions, rates, recurring, upcoming, today } = detail;
  const posted = transactions.filter((t) => t.date <= today);
  return {
    ...loanOverview(detail),
    today,
    start_date: loan.startDate,
    principal_kr: kr(ledger.principalOre),
    accrued_interest_kr: kr(ledger.accruedInterestOre),
    interest_capitalization: loan.capitalization,
    totals: {
      disbursed_kr: kr(ledger.totals.disbursedOre),
      repaid_kr: kr(ledger.totals.repaidOre),
      repaid_principal_kr: kr(ledger.totals.repaidPrincipalOre),
      paid_interest_kr: kr(ledger.totals.paidInterestOre),
      fees_kr: kr(ledger.totals.feesOre),
      capitalized_interest_kr: kr(ledger.totals.capitalizedInterestOre),
    },
    transaction_count: posted.length,
    first_transaction_date: posted[0]?.date ?? null,
    last_transaction_date: posted.at(-1)?.date ?? null,
    rates: rates.map((r) => ({ valid_from: r.validFrom, annual_rate: formatRate(r.annualRateBp) })),
    recurring_payments: recurring.map((r) => ({
      kind: r.kind,
      amount_kr: kr(r.amountOre),
      day_of_month: r.dayOfMonth,
      start_date: r.startDate,
      end_date: r.endDate,
      next_due: r.endDate && r.nextDue > r.endDate ? null : r.nextDue,
      note: r.note,
    })),
    // The plan the app follows up on, if the user has chosen one.
    followed_plan: detail.activePlan
      ? {
          name: detail.activePlan.plan.name,
          monthly_payment_kr: kr(detail.activePlan.plan.monthlyOre),
          day_of_month: detail.activePlan.plan.dayOfMonth,
          start_date: detail.activePlan.plan.startDate,
          expected_so_far_kr: kr(detail.activePlan.status.expectedOre),
          repaid_so_far_kr: kr(detail.activePlan.status.paidOre),
          // Positive: ahead of plan. Negative: behind.
          ahead_of_plan_kr: kr(detail.activePlan.status.aheadOre),
          unregistered_payment: detail.activePlan.status.pending
            ? { due_date: detail.activePlan.status.pending.dueDate, amount_kr: kr(detail.activePlan.status.pending.amountOre) }
            : null,
          next_payment: detail.activePlan.status.next
            ? { date: detail.activePlan.status.next.date, amount_kr: kr(detail.activePlan.status.next.amountOre) }
            : null,
        }
      : null,
    other_plans: detail.plans.filter((plan) => !plan.isActive).map((plan) => ({ name: plan.name, monthly_payment_kr: kr(plan.monthlyOre) })),
    upcoming_transactions: upcoming.map((t) => ({
      date: t.date,
      kind: t.kind,
      amount_kr: kr(t.amountOre),
      note: t.note,
    })),
  };
}

// ── Timeline ────────────────────────────────────────────────────────────────

export interface TimelineFilter {
  from?: string;
  to?: string;
  types?: LedgerEntryType[];
  limit?: number;
  newestFirst?: boolean;
}

export const TIMELINE_DEFAULT_LIMIT = 50;
export const TIMELINE_MAX_LIMIT = 200;

/** Ledger entries with running balance for `list_loan_transactions`. */
export function loanTimeline(detail: LoanDetail, filter: TimelineFilter = {}) {
  const limit = Math.min(Math.max(filter.limit ?? TIMELINE_DEFAULT_LIMIT, 1), TIMELINE_MAX_LIMIT);
  const matches = detail.ledger.entries.filter(
    (e) =>
      (!filter.from || e.date >= filter.from) &&
      (!filter.to || e.date <= filter.to) &&
      (!filter.types?.length || filter.types.includes(e.type)),
  );
  const ordered = filter.newestFirst === false ? matches : [...matches].reverse();
  // Who registered each transaction, when it was someone other than the user.
  const addedBy = new Map(detail.transactions.map((t) => [t.id, t.addedBy]));
  const sum = (type: LedgerEntryType) =>
    kr(matches.filter((e) => e.type === type).reduce((total, e) => total + Math.abs(e.deltaOre), 0));

  return {
    loan_id: detail.loan.id,
    // Sums cover every match, also the ones cut off by `limit`.
    matching_entries: matches.length,
    returned_entries: Math.min(matches.length, limit),
    sums: {
      disbursed_kr: sum("disbursement"),
      repaid_kr: sum("repayment"),
      fees_kr: sum("fee"),
    },
    entries: ordered.slice(0, limit).map((e) => ({
      date: e.date,
      type: e.type,
      change_kr: kr(e.deltaOre),
      ...(e.type === "repayment" && e.interestPartOre > 0
        ? { interest_part_kr: kr(e.interestPartOre), principal_part_kr: kr(e.principalPartOre) }
        : {}),
      balance_after_kr: kr(e.balanceAfterOre),
      ...(e.type === "rate_change" && e.annualRateBp !== undefined
        ? { annual_rate: formatRate(e.annualRateBp) }
        : {}),
      ...(e.note ? { note: e.note } : {}),
      ...(e.transactionId && addedBy.get(e.transactionId) ? { added_by: addedBy.get(e.transactionId) } : {}),
    })),
  };
}

// ── Simulation ──────────────────────────────────────────────────────────────

export interface SimulationOptions {
  /** Replaces the loan's recurring repayments with this monthly amount. */
  monthlyPaymentKr?: number;
  /** Day of month for `monthlyPaymentKr`. Defaults to today's day. */
  dayOfMonth?: number;
  /** Find the monthly amount that clears the loan by this date instead. */
  payoffBy?: string;
  /** Assume this annual rate (percent) from today instead of the loan's rates. */
  annualRatePercent?: number;
  /** One-off extra repayments on given dates. */
  extraPayments?: { date: string; amountKr: number }[];
}

/** Forward simulation for `simulate_repayment`. Never touches stored data. */
export function simulateRepayment(detail: LoanDetail, options: SimulationOptions = {}) {
  const { today } = detail;
  const balanceOre = detail.ledger.balanceOre;
  if (balanceOre <= 0) return { loan_id: detail.loan.id, today, balance_kr: kr(balanceOre), note: "Nothing left to repay." };

  const horizon = addYears(today, MAX_YEARS);
  const rateBp = options.annualRatePercent === undefined ? undefined : Math.round(options.annualRatePercent * 100);
  const day = options.dayOfMonth ?? Number(today.slice(8, 10));
  const extras: LoanTransaction[] = (options.extraPayments ?? [])
    .filter((p) => p.date > today && p.amountKr > 0)
    .map((p) => ({ date: p.date, amountOre: toOre(p.amountKr), kind: "repayment" }));

  let monthlyOre: number | null = options.monthlyPaymentKr === undefined ? null : toOre(options.monthlyPaymentKr);
  const customMonthly = monthlyOre !== null || options.payoffBy !== undefined;
  const base = [...plannedTransactions(detail, horizon, !customMonthly), ...extras];
  // Smallest whole-krone monthly amount that clears the loan by the date.
  if (options.payoffBy !== undefined) monthlyOre = monthlyForPayoff(detail, base, today, options.payoffBy, day, rateBp);
  const unreachable = options.payoffBy !== undefined && monthlyOre === null;

  const future = [...base, ...(monthlyOre !== null ? monthlyRepayments(today, horizon, day, monthlyOre) : [])];
  const run = project(detail, future, rateBp, horizon);
  // Whatever is repaid beyond today's balance and new money out is the cost.
  const addedOre = base
    .filter((t) => t.kind !== "repayment" && (!run.payoffDate || t.date <= run.payoffDate))
    .reduce((total, t) => total + t.amountOre, 0);

  return {
    loan_id: detail.loan.id,
    today,
    balance_kr: kr(balanceOre),
    assumptions: {
      monthly_payment_kr: monthlyOre === null ? null : kr(monthlyOre),
      monthly_payment_day: monthlyOre === null ? null : day,
      uses_existing_recurring_repayments: !customMonthly,
      annual_rate: rateBp === undefined ? "the loan's own rates" : formatRate(rateBp),
      extra_payments: extras.map((p) => ({ date: p.date, amount_kr: kr(p.amountOre) })),
    },
    ...(options.payoffBy !== undefined
      ? {
          payoff_by: options.payoffBy,
          required_monthly_payment_kr: monthlyOre === null ? null : kr(monthlyOre),
          first_payment_date: firstDueAfter(today, day),
          ...(unreachable ? { payoff_by_note: "No monthly payment falls due before that date." } : {}),
        }
      : {}),
    paid_off: run.paidOff,
    payoff_date: run.payoffDate,
    number_of_payments: run.payments,
    last_payment_kr: run.lastPaymentOre === null ? null : kr(run.lastPaymentOre),
    total_paid_kr: kr(run.totalPaidOre),
    interest_and_fees_cost_kr: run.paidOff ? kr(run.totalPaidOre - balanceOre - addedOre) : null,
    ...(run.paidOff
      ? {}
      : {
          balance_after_60_years_kr: kr(run.endBalanceOre),
          note:
            run.payments === 0
              ? "No repayments are planned, so the loan is never paid off."
              : "The planned repayments do not clear the loan within 60 years.",
        }),
    balance_at_new_year: run.checkpoints.map((c) => ({ date: c.date, balance_kr: kr(c.balanceOre) })),
  };
}
