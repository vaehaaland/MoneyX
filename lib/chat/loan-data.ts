/**
 * Shapes loan data for the chat tools. Pure: everything is derived from a
 * `LoanDetail` through the loan engine, so the chat reports the same numbers
 * as the screens. Amounts leave here as kroner (øre / 100) because that is
 * the unit the model talks to the user in.
 */
import { formatRate } from "../format";
import { balanceLabel } from "../labels";
import { computeLedger, fromDayNumber, toDayNumber, type LedgerEntryType, type LoanTransaction } from "../loan-engine";
import type { LoanDetail } from "../loans";
import { dueDateInMonth, dueDatesBetween } from "../recurring";

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

const MAX_YEARS = 60;

function addYears(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
}

/** Payments the loan already has planned from today: future-dated rows and recurring rules. */
function plannedTransactions(detail: LoanDetail, horizon: string, includeRecurringRepayments: boolean) {
  const planned: LoanTransaction[] = detail.upcoming.map((t) => ({ date: t.date, amountOre: t.amountOre, kind: t.kind }));
  for (const rule of detail.recurring) {
    if (rule.kind === "repayment" && !includeRecurringRepayments) continue;
    const from = rule.nextDue > detail.today ? rule.nextDue : detail.today;
    const to = rule.endDate && rule.endDate < horizon ? rule.endDate : horizon;
    for (const date of dueDatesBetween(from, to, rule.dayOfMonth)) {
      planned.push({ date, amountOre: rule.amountOre, kind: rule.kind });
    }
  }
  return planned;
}

interface Projection {
  paidOff: boolean;
  payoffDate: string | null;
  payments: number;
  totalPaidOre: number;
  lastPaymentOre: number | null;
  endBalanceOre: number;
  checkpoints: { date: string; balanceOre: number }[];
}

/** Runs the engine forward from today with the given future transactions. */
function project(detail: LoanDetail, future: LoanTransaction[], rateBp: number | undefined, horizon: string): Projection {
  const past = detail.transactions.filter((t) => t.date <= detail.today);
  const rates =
    rateBp === undefined
      ? detail.rates
      : [...detail.rates.filter((r) => r.validFrom < detail.today), { validFrom: detail.today, annualRateBp: rateBp }];
  const sorted = [...future].sort((a, b) => a.date.localeCompare(b.date));
  const ledger = computeLedger({
    transactions: [...past, ...sorted],
    rates,
    capitalization: detail.loan.capitalization,
    until: fromDayNumber(toDayNumber(horizon) + 1),
  });

  const result: Projection = {
    paidOff: false,
    payoffDate: null,
    payments: 0,
    totalPaidOre: 0,
    lastPaymentOre: null,
    endBalanceOre: ledger.balanceOre,
    checkpoints: [],
  };
  let year = detail.today.slice(0, 4);
  let previous = detail.ledger.balanceOre;
  for (const entry of ledger.entries) {
    if (entry.date <= detail.today) continue;
    // One checkpoint per calendar year: the balance going into the new year.
    if (entry.date.slice(0, 4) !== year) {
      year = entry.date.slice(0, 4);
      result.checkpoints.push({ date: `${year}-01-01`, balanceOre: previous });
    }
    previous = entry.balanceAfterOre;
    if (entry.type !== "repayment") continue;
    result.payments += 1;
    if (entry.balanceAfterOre <= 0) {
      // The final payment only needs to cover what is left.
      const last = -entry.deltaOre + entry.balanceAfterOre;
      result.totalPaidOre += last;
      result.lastPaymentOre = last;
      result.paidOff = true;
      result.payoffDate = entry.date;
      result.endBalanceOre = 0;
      break;
    }
    result.totalPaidOre += -entry.deltaOre;
  }
  return result;
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

  // Monthly payments start on the first due date after today.
  const monthly = (amountOre: number, until: string): LoanTransaction[] =>
    amountOre <= 0
      ? []
      : dueDatesBetween(today, until, day)
          .filter((date) => date > today)
          .map((date) => ({ date, amountOre, kind: "repayment" }));

  let monthlyOre: number | null = options.monthlyPaymentKr === undefined ? null : toOre(options.monthlyPaymentKr);
  const customMonthly = monthlyOre !== null || options.payoffBy !== undefined;
  const base = [...plannedTransactions(detail, horizon, !customMonthly), ...extras];
  let unreachable = false;

  if (options.payoffBy !== undefined) {
    // Smallest whole-krone monthly amount that clears the loan by the date.
    const deadline = options.payoffBy;
    const clears = (ore: number) => {
      const run = project(detail, [...base, ...monthly(ore, deadline)], rateBp, deadline);
      return run.paidOff;
    };
    let high = Math.ceil(balanceOre / 100) * 100;
    for (let i = 0; i < 12 && !clears(high); i++) high *= 2;
    if (!clears(high)) unreachable = true;
    let low = 0;
    while (!unreachable && high - low > 100) {
      const mid = Math.floor((low + high) / 200) * 100;
      if (clears(mid)) high = mid;
      else low = mid;
    }
    monthlyOre = unreachable ? null : high;
  }

  const future = [...base, ...(monthlyOre !== null ? monthly(monthlyOre, horizon) : [])];
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
          first_payment_date: dueDateInMonthAfter(today, day),
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

/** First monthly due date strictly after `today`. */
function dueDateInMonthAfter(today: string, day: number): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const due = dueDateInMonth(year, month, day);
  return due > today ? due : dueDateInMonth(month === 11 ? year + 1 : year, (month + 1) % 12, day);
}
