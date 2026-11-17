/**
 * Loan engine: derives balance, accrued interest and a ledger from
 * transactions and rate changes. Pure and dependency-free so the UI, server
 * code and chat tools all compute the same numbers.
 *
 * Conventions
 * - Money is integer øre. Dates are ISO `YYYY-MM-DD` strings.
 * - A transaction takes effect at the start of its date. Interest for a day
 *   accrues on the principal as it stands after that day's transactions.
 * - `until` is exclusive for accrual: the result is the position at the start
 *   of that day.
 * - Interest is simple between capitalizations (ACT/365) and is tracked
 *   exactly, rounded to whole øre only when it is paid, capitalized or shown.
 * - Repayments cover accrued interest first, then principal.
 */

export type TransactionKind = "disbursement" | "repayment" | "fee" | "adjustment";
export type Capitalization = "none" | "monthly" | "yearly";

export interface LoanTransaction {
  id?: string;
  date: string;
  /** Positive øre. Only `adjustment` may be negative (reduces principal). */
  amountOre: number;
  kind: TransactionKind;
  note?: string | null;
}

export interface LoanRate {
  validFrom: string;
  /** Annual nominal rate in basis points: 550 = 5.50 %. */
  annualRateBp: number;
}

export interface LedgerInput {
  transactions: LoanTransaction[];
  rates: LoanRate[];
  capitalization: Capitalization;
  /** Compute the position at the start of this date. */
  until: string;
}

export type LedgerEntryType = TransactionKind | "capitalization" | "rate_change";

export interface LedgerEntry {
  date: string;
  type: LedgerEntryType;
  /** Signed effect on the total balance (principal + accrued interest). */
  deltaOre: number;
  /** Part of a repayment that covered interest. */
  interestPartOre: number;
  /** Part of a repayment that reduced principal. */
  principalPartOre: number;
  principalAfterOre: number;
  accruedInterestAfterOre: number;
  balanceAfterOre: number;
  /** Set for `rate_change`. */
  annualRateBp?: number;
  transactionId?: string;
  note?: string | null;
}

export interface LedgerResult {
  entries: LedgerEntry[];
  principalOre: number;
  accruedInterestOre: number;
  /** Principal plus accrued interest. */
  balanceOre: number;
  currentRateBp: number;
  totals: {
    disbursedOre: number;
    repaidOre: number;
    repaidPrincipalOre: number;
    paidInterestOre: number;
    feesOre: number;
    capitalizedInterestOre: number;
  };
  /**
   * Balance over time for charting with straight lines. A date on which the
   * balance jumped appears twice: before and after that day's events.
   */
  series: { date: string; balanceOre: number }[];
}

const DAY_MS = 86_400_000;
/** Accrued interest is held as øre × INTEREST_DENOMINATOR (bp × days / 365). */
const INTEREST_DENOMINATOR = BigInt(10_000 * 365);

export function toDayNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const check = new Date(ms);
  if (check.getUTCMonth() !== Number(m) - 1 || check.getUTCDate() !== Number(d)) {
    throw new Error(`Invalid date: ${date}`);
  }
  return Math.round(ms / DAY_MS);
}

export function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));
}

/** Day numbers of every capitalization boundary in (fromDay, toDay]. */
function capitalizationDays(mode: Capitalization, fromDay: number, toDay: number): number[] {
  if (mode === "none" || toDay <= fromDay) return [];
  const days: number[] = [];
  const start = new Date(fromDay * DAY_MS);
  let year = start.getUTCFullYear();
  let month = mode === "yearly" ? 0 : start.getUTCMonth();
  for (;;) {
    const day = Math.round(Date.UTC(year, month, 1) / DAY_MS);
    if (day > toDay) break;
    if (day > fromDay) days.push(day);
    if (mode === "yearly") year += 1;
    else month += 1;
  }
  return days;
}

type Event =
  | { day: number; order: 0; type: "capitalization" }
  | { day: number; order: 1; type: "rate_change"; annualRateBp: number }
  | { day: number; order: 2; type: "transaction"; tx: LoanTransaction; index: number };

export function computeLedger(input: LedgerInput): LedgerResult {
  const untilDay = toDayNumber(input.until);

  const transactions = input.transactions
    .map((tx, index) => ({ tx, index, day: toDayNumber(tx.date) }))
    .filter((t) => t.day <= untilDay);
  for (const { tx } of transactions) {
    if (!Number.isSafeInteger(tx.amountOre) || tx.amountOre === 0) {
      throw new Error(`Invalid amount on ${tx.date}: ${tx.amountOre}`);
    }
    if (tx.amountOre < 0 && tx.kind !== "adjustment") {
      throw new Error(`Only adjustments may be negative (${tx.date})`);
    }
  }

  const rates = input.rates
    .map((r) => ({ ...r, day: toDayNumber(r.validFrom) }))
    .sort((a, b) => a.day - b.day);

  const result: LedgerResult = {
    entries: [],
    principalOre: 0,
    accruedInterestOre: 0,
    balanceOre: 0,
    currentRateBp: 0,
    totals: {
      disbursedOre: 0,
      repaidOre: 0,
      repaidPrincipalOre: 0,
      paidInterestOre: 0,
      feesOre: 0,
      capitalizedInterestOre: 0,
    },
    series: [],
  };

  if (transactions.length === 0) {
    result.currentRateBp = rates.filter((r) => r.day <= untilDay).at(-1)?.annualRateBp ?? 0;
    return result;
  }

  const firstDay = Math.min(...transactions.map((t) => t.day));

  const events: Event[] = [];
  for (const t of transactions) {
    events.push({ day: t.day, order: 2, type: "transaction", tx: t.tx, index: t.index });
  }
  let rateBp = 0;
  for (const r of rates) {
    if (r.day <= firstDay) rateBp = r.annualRateBp;
    else if (r.day <= untilDay) {
      events.push({ day: r.day, order: 1, type: "rate_change", annualRateBp: r.annualRateBp });
    }
  }
  for (const day of capitalizationDays(input.capitalization, firstDay, untilDay)) {
    events.push({ day, order: 0, type: "capitalization" });
  }
  events.sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day;
    if (a.order !== b.order) return a.order - b.order;
    if (a.type === "transaction" && b.type === "transaction") return a.index - b.index;
    return 0;
  });

  let principal = 0;
  let accrued = BigInt(0); // øre × INTEREST_DENOMINATOR
  let cursor = firstDay;
  const totals = result.totals;

  const accruedOre = () => roundHalfUp(accrued, INTEREST_DENOMINATOR);
  const accrueTo = (day: number) => {
    if (day > cursor && principal > 0 && rateBp > 0) {
      accrued += BigInt(principal) * BigInt(rateBp) * BigInt(day - cursor);
    }
    cursor = day;
  };
  // Two points per date at most: the balance on arrival (after interest has
  // accrued) and the balance once that day's events are applied. Drawn with
  // straight lines this gives slopes for interest and vertical steps for money.
  const pushSeries = (day: number, arriving = false) => {
    const date = fromDayNumber(day);
    const balanceOre = principal + accruedOre();
    const sameDate = result.series.filter((point) => point.date === date);
    if (arriving) {
      if (sameDate.length === 0) result.series.push({ date, balanceOre });
    } else if (sameDate.length === 2) {
      sameDate[1].balanceOre = balanceOre;
    } else if (sameDate.length === 0 || sameDate[0].balanceOre !== balanceOre) {
      result.series.push({ date, balanceOre });
    }
  };
  const pushEntry = (
    day: number,
    entry: Pick<LedgerEntry, "type" | "deltaOre"> & Partial<LedgerEntry>,
  ) => {
    const interest = accruedOre();
    result.entries.push({
      interestPartOre: 0,
      principalPartOre: 0,
      ...entry,
      date: fromDayNumber(day),
      principalAfterOre: principal,
      accruedInterestAfterOre: interest,
      balanceAfterOre: principal + interest,
    });
    pushSeries(day);
  };

  for (const event of events) {
    accrueTo(event.day);
    if (result.series.length > 0) pushSeries(event.day, true);

    if (event.type === "capitalization") {
      const interest = accruedOre();
      accrued = BigInt(0);
      if (interest === 0) continue;
      principal += interest;
      totals.capitalizedInterestOre += interest;
      pushEntry(event.day, { type: "capitalization", deltaOre: 0, interestPartOre: interest });
      continue;
    }

    if (event.type === "rate_change") {
      if (event.annualRateBp === rateBp) continue;
      rateBp = event.annualRateBp;
      pushEntry(event.day, { type: "rate_change", deltaOre: 0, annualRateBp: rateBp });
      continue;
    }

    const { tx } = event;
    const common = { transactionId: tx.id, note: tx.note ?? null };
    if (tx.kind === "repayment") {
      const interestDue = accruedOre();
      const interestPart = Math.min(tx.amountOre, interestDue);
      const principalPart = tx.amountOre - interestPart;
      accrued =
        interestPart === interestDue
          ? BigInt(0)
          : accrued - BigInt(interestPart) * INTEREST_DENOMINATOR;
      principal -= principalPart;
      totals.repaidOre += tx.amountOre;
      totals.paidInterestOre += interestPart;
      totals.repaidPrincipalOre += principalPart;
      pushEntry(event.day, {
        ...common,
        type: "repayment",
        deltaOre: -tx.amountOre,
        interestPartOre: interestPart,
        principalPartOre: principalPart,
      });
    } else {
      principal += tx.amountOre;
      if (tx.kind === "disbursement") totals.disbursedOre += tx.amountOre;
      if (tx.kind === "fee") totals.feesOre += tx.amountOre;
      pushEntry(event.day, { ...common, type: tx.kind, deltaOre: tx.amountOre });
    }
  }

  accrueTo(untilDay);
  pushSeries(untilDay, true);

  result.principalOre = principal;
  result.accruedInterestOre = accruedOre();
  result.balanceOre = result.principalOre + result.accruedInterestOre;
  result.currentRateBp = rateBp;
  return result;
}
