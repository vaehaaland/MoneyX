/**
 * Repayment plans: a fixed monthly amount from a start date plus optional
 * one-off payments. Pure. A plan is never posted; it is simulated from the
 * actual balance, and progress is measured against what was really repaid.
 */
import type { LoanTransaction } from "./loan-engine";
import type { LoanDetail } from "./loans";
import { addYears, MAX_YEARS, plannedTransactions, project, type Projection } from "./projection";
import { dueDatesBetween } from "./recurring";

export interface PlanExtra {
  date: string;
  amountOre: number;
}

export interface LoanPlan {
  id: string;
  name: string;
  monthlyOre: number;
  dayOfMonth: number;
  startDate: string;
  /** Null: simulate with the loan's own rates. */
  assumedRateBp: number | null;
  extras: PlanExtra[];
  isActive: boolean;
}

/** An answer to "did you pay?" other than yes: skipped for good, or ask again later. */
export interface PlanAnswer {
  dueDate: string;
  status: "skipped" | "snoozed";
  snoozedUntil: string | null;
}

export interface PlanPayment {
  date: string;
  amountOre: number;
  extra: boolean;
}

/** Every payment the plan calls for from its start to `to`, both inclusive, in date order. */
export function planPayments(plan: Pick<LoanPlan, "monthlyOre" | "dayOfMonth" | "startDate" | "extras">, to: string): PlanPayment[] {
  const monthly: PlanPayment[] =
    plan.monthlyOre > 0 && to >= plan.startDate
      ? dueDatesBetween(plan.startDate, to, plan.dayOfMonth).map((date) => ({ date, amountOre: plan.monthlyOre, extra: false }))
      : [];
  const extras = plan.extras
    .filter((e) => e.date >= plan.startDate && e.date <= to && e.amountOre > 0)
    .map((e) => ({ date: e.date, amountOre: e.amountOre, extra: true }));
  // Same day: the regular payment first.
  return [...monthly, ...extras].sort((a, b) => a.date.localeCompare(b.date) || Number(a.extra) - Number(b.extra));
}

export interface PlanResult extends Projection {
  /** What the plan costs beyond today's balance and any new money lent: interest and fees. */
  costOre: number | null;
}

/**
 * Where the plan leads from today's actual balance. The plan replaces the
 * loan's recurring repayments; future-dated rows and recurring disbursements
 * still count.
 */
export function simulatePlan(detail: LoanDetail, plan: Pick<LoanPlan, "monthlyOre" | "dayOfMonth" | "startDate" | "extras" | "assumedRateBp">): PlanResult {
  const horizon = addYears(detail.today, MAX_YEARS);
  const base = plannedTransactions(detail, horizon, false);
  const future: LoanTransaction[] = [
    ...base,
    ...planPayments(plan, horizon)
      .filter((p) => p.date > detail.today)
      .map((p): LoanTransaction => ({ date: p.date, amountOre: p.amountOre, kind: "repayment" })),
  ];
  const run = project(detail, future, plan.assumedRateBp ?? undefined, horizon);
  const addedOre = base
    .filter((t) => t.kind !== "repayment" && (!run.payoffDate || t.date <= run.payoffDate))
    .reduce((total, t) => total + t.amountOre, 0);
  return { ...run, costOre: run.paidOff ? run.totalPaidOre - detail.ledger.balanceOre - addedOre : null };
}

export interface PlanStatus {
  /** What the plan called for from its start until today, minus skipped payments. */
  expectedOre: number;
  /** What was actually repaid in the same period. */
  paidOre: number;
  /** Positive: ahead of the plan. Negative: behind. */
  aheadOre: number;
  /**
   * The oldest planned payment that the repayments so far do not cover. This
   * is what the app asks about. Null when on or ahead of plan.
   */
  pending: { dueDate: string; amountOre: number; snoozed: boolean } | null;
  /** The next planned payment after today. */
  next: PlanPayment | null;
}

/**
 * Progress against a plan. Payments are matched by running total, not one to
 * one: paying double one month covers the next, and a payment registered by
 * the other party or by a recurring rule counts like any other.
 */
export function planStatus(detail: LoanDetail, plan: LoanPlan, answers: PlanAnswer[]): PlanStatus {
  const { today } = detail;
  const skipped = new Set(answers.filter((a) => a.status === "skipped").map((a) => a.dueDate));
  const due = planPayments(plan, today).filter((p) => !skipped.has(p.date));
  const paidOre = detail.transactions
    .filter((t) => t.kind === "repayment" && t.date >= plan.startDate && t.date <= today)
    .reduce((total, t) => total + t.amountOre, 0);
  const expectedOre = due.reduce((total, p) => total + p.amountOre, 0);

  let pending: PlanStatus["pending"] = null;
  const balanceOre = detail.ledger.balanceOre;
  if (balanceOre > 0) {
    let running = 0;
    for (const payment of due) {
      running += payment.amountOre;
      if (running <= paidOre) continue;
      const answer = answers.find((a) => a.dueDate === payment.date && a.status === "snoozed");
      pending = {
        dueDate: payment.date,
        // Ask for what is missing on this payment, never more than is owed.
        amountOre: Math.min(payment.amountOre, running - paidOre, balanceOre),
        snoozed: Boolean(answer?.snoozedUntil && answer.snoozedUntil > today),
      };
      break;
    }
  }

  const horizon = addYears(today, 2);
  const next = balanceOre > 0 ? (planPayments(plan, horizon).find((p) => p.date > today) ?? null) : null;
  return { expectedOre, paidOre, aheadOre: paidOre - expectedOre, pending, next };
}

/** Planned money per month for the coming months, for the look-ahead on the front page. */
export function upcomingByMonth(payments: { date: string; amountOre: number }[], today: string, months: number) {
  const buckets: { month: string; amountOre: number; count: number }[] = [];
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < months; i++) {
    buckets.push({ month: `${year}-${String(month).padStart(2, "0")}`, amountOre: 0, count: 0 });
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  for (const payment of payments) {
    if (payment.date <= today) continue;
    const bucket = buckets.find((b) => b.month === payment.date.slice(0, 7));
    if (bucket) {
      bucket.amountOre += payment.amountOre;
      bucket.count += 1;
    }
  }
  return buckets;
}
