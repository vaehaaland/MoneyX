/**
 * Runs the loan engine forward from today. Shared by repayment plans and the
 * chat's simulation tool, so both give the same payoff dates. Pure: nothing
 * here reads or writes stored data.
 */
import { computeLedger, fromDayNumber, toDayNumber, type LoanTransaction } from "./loan-engine";
import type { LoanDetail } from "./loans";
import { dueDateInMonth, dueDatesBetween } from "./recurring";

/** How far ahead a simulation looks before giving up on a payoff date. */
export const MAX_YEARS = 60;

export function addYears(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
}

/** First monthly due date strictly after `date`. */
export function firstDueAfter(date: string, dayOfMonth: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  const due = dueDateInMonth(year, month, dayOfMonth);
  return due > date ? due : dueDateInMonth(month === 11 ? year + 1 : year, (month + 1) % 12, dayOfMonth);
}

/** A fixed monthly repayment on every due date after `after`, up to `until`. */
export function monthlyRepayments(after: string, until: string, dayOfMonth: number, amountOre: number): LoanTransaction[] {
  if (amountOre <= 0) return [];
  return dueDatesBetween(after, until, dayOfMonth)
    .filter((date) => date > after)
    .map((date) => ({ date, amountOre, kind: "repayment" }));
}

/**
 * What the loan already has coming after today: future-dated rows and
 * recurring rules. A custom monthly amount replaces the recurring repayments,
 * so those can be left out.
 */
export function plannedTransactions(detail: LoanDetail, horizon: string, includeRecurringRepayments: boolean) {
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

export interface Projection {
  paidOff: boolean;
  payoffDate: string | null;
  /** Repayments made after today, up to and including the last one. */
  payments: number;
  totalPaidOre: number;
  /** The final payment only covers what is left, so it is usually smaller. */
  lastPaymentOre: number | null;
  endBalanceOre: number;
  /** Balance going into each new year. */
  checkpoints: { date: string; balanceOre: number }[];
  /** Balance from today to payoff (or the horizon), for charting. */
  series: { date: string; balanceOre: number }[];
}

/** Runs the engine from today with the given future transactions. */
export function project(detail: LoanDetail, future: LoanTransaction[], rateBp: number | undefined, horizon: string): Projection {
  const { today } = detail;
  const past = detail.transactions.filter((t) => t.date <= today);
  const rates =
    rateBp === undefined
      ? detail.rates
      : [...detail.rates.filter((r) => r.validFrom < today), { validFrom: today, annualRateBp: rateBp }];
  const sorted = future.filter((t) => t.date > today).sort((a, b) => a.date.localeCompare(b.date));
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
    series: [],
  };
  let year = today.slice(0, 4);
  let previous = detail.ledger.balanceOre;
  for (const entry of ledger.entries) {
    if (entry.date <= today) continue;
    // One checkpoint per calendar year: the balance going into the new year.
    if (entry.date.slice(0, 4) !== year) {
      year = entry.date.slice(0, 4);
      result.checkpoints.push({ date: `${year}-01-01`, balanceOre: previous });
    }
    previous = entry.balanceAfterOre;
    if (entry.type !== "repayment") continue;
    result.payments += 1;
    if (entry.balanceAfterOre <= 0) {
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

  // The engine's series has two points on days the balance jumped. Keep
  // today onwards, stop at payoff and never draw below zero.
  const end = result.payoffDate ?? horizon;
  result.series = [
    { date: today, balanceOre: detail.ledger.balanceOre },
    ...ledger.series.filter((p) => p.date > today && p.date <= end).map((p) => ({ ...p, balanceOre: Math.max(p.balanceOre, 0) })),
  ];
  return result;
}

/**
 * The smallest whole-krone monthly amount that clears the loan by `deadline`,
 * on top of `base`. Null when no due date falls before the deadline.
 */
export function monthlyForPayoff(
  detail: LoanDetail,
  base: LoanTransaction[],
  after: string,
  deadline: string,
  dayOfMonth: number,
  rateBp: number | undefined,
): number | null {
  const clears = (ore: number) =>
    project(detail, [...base, ...monthlyRepayments(after, deadline, dayOfMonth, ore)], rateBp, deadline).paidOff;
  let high = Math.max(100, Math.ceil(detail.ledger.balanceOre / 100) * 100);
  for (let i = 0; i < 12 && !clears(high); i++) high *= 2;
  if (!clears(high)) return null;
  let low = 0;
  while (high - low > 100) {
    const mid = Math.floor((low + high) / 200) * 100;
    if (clears(mid)) high = mid;
    else low = mid;
  }
  return high;
}
