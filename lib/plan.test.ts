import { describe, expect, it } from "vitest";
import { computeLedger } from "./loan-engine";
import type { LoanDetail, LoanTransactionRow } from "./loans";
import { planPayments, planStatus, simulatePlan, upcomingByMonth, type LoanPlan, type PlanAnswer } from "./plan";
import { monthlyForPayoff } from "./projection";

const ore = (kroner: number) => Math.round(kroner * 100);

let nextId = 0;
const tx = (date: string, kind: LoanTransactionRow["kind"], kroner: number): LoanTransactionRow => ({
  id: `tx-${nextId++}`,
  date,
  kind,
  amountOre: ore(kroner),
  note: null,
  recurring: false,
  addedBy: null,
  isNew: false,
});

function detail(transactions: LoanTransactionRow[], today: string, rateBp = 0): LoanDetail {
  const rates = rateBp > 0 ? [{ id: "r", validFrom: "2026-01-01", annualRateBp: rateBp }] : [];
  return {
    loan: {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Lån",
      counterpartyName: "Kari",
      direction: "borrowed",
      startDate: "2026-01-01",
      capitalization: "none",
      archivedAt: null,
      isOwner: true,
      role: "owner",
      canWrite: true,
    },
    transactions,
    rates,
    recurring: [],
    ledger: computeLedger({ transactions, rates, capitalization: "none", until: today }),
    upcoming: transactions.filter((t) => t.date > today),
    today,
    people: [],
    newCount: 0,
    plans: [],
    activePlan: null,
  };
}

const plan = (overrides: Partial<LoanPlan> = {}): LoanPlan => ({
  id: "p1",
  name: "4 000 kr i månaden",
  monthlyOre: ore(4_000),
  dayOfMonth: 15,
  startDate: "2026-06-01",
  assumedRateBp: null,
  extras: [],
  isActive: true,
  ...overrides,
});

const LOAN = [tx("2026-01-10", "disbursement", 100_000)];

describe("planPayments", () => {
  it("lists monthly payments from the start date, with one-off payments in date order", () => {
    const payments = planPayments(plan({ extras: [{ date: "2026-07-15", amountOre: ore(10_000) }, { date: "2026-05-01", amountOre: ore(1) }] }), "2026-08-14");
    expect(payments.map((p) => [p.date, p.amountOre / 100, p.extra])).toEqual([
      ["2026-06-15", 4_000, false],
      ["2026-07-15", 4_000, false],
      // Same day: after the regular payment. The one before the start date is ignored.
      ["2026-07-15", 10_000, true],
    ]);
  });

  it("uses the last day of shorter months", () => {
    const payments = planPayments(plan({ dayOfMonth: 31, startDate: "2027-01-01" }), "2027-03-31");
    expect(payments.map((p) => p.date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });
});

describe("simulatePlan", () => {
  it("projects from the actual balance today", () => {
    const result = simulatePlan(detail(LOAN, "2026-06-01"), plan());
    // 100 000 / 4 000 = 25 payments, 15 June 2026 to 15 June 2028.
    expect(result.paidOff).toBe(true);
    expect(result.payments).toBe(25);
    expect(result.payoffDate).toBe("2028-06-15");
    expect(result.costOre).toBe(0);
    expect(result.series[0]).toEqual({ date: "2026-06-01", balanceOre: ore(100_000) });
    expect(result.series.at(-1)).toEqual({ date: "2028-06-15", balanceOre: 0 });
  });

  it("moves when reality differs from the plan", () => {
    // Paid 20 000 extra along the way: five fewer payments left than the plan alone would give.
    const ahead = detail([...LOAN, tx("2026-06-15", "repayment", 4_000), tx("2026-07-01", "repayment", 20_000)], "2026-07-02");
    const result = simulatePlan(ahead, plan());
    expect(result.payments).toBe(19);
    expect(result.payoffDate).toBe("2028-01-15");
  });

  it("counts one-off payments and an assumed rate", () => {
    const extra = simulatePlan(detail(LOAN, "2026-06-01"), plan({ extras: [{ date: "2026-12-01", amountOre: ore(40_000) }] }));
    expect(extra.payments).toBe(16); // 15 monthly + the one-off
    expect(extra.payoffDate).toBe("2027-08-15");

    const withRate = simulatePlan(detail(LOAN, "2026-06-01"), plan({ assumedRateBp: 500 }));
    expect(withRate.costOre).toBeGreaterThan(ore(4_000));
    expect(withRate.payments).toBeGreaterThan(25);
  });

  it("says so when the plan never clears the loan", () => {
    const result = simulatePlan(detail(LOAN, "2026-06-01", 1200), plan({ monthlyOre: ore(500) }));
    expect(result.paidOff).toBe(false);
    expect(result.costOre).toBeNull();
  });

  it("gives the monthly amount for a target date", () => {
    const loan = detail(LOAN, "2026-06-01");
    // 24 due dates from 15 June 2026 to 15 May 2028.
    const monthly = monthlyForPayoff(loan, [], loan.today, "2028-06-01", 15, undefined);
    expect(monthly).toBe(ore(4_167));
    expect(simulatePlan(loan, plan({ monthlyOre: monthly! })).payoffDate).toBe("2028-05-15");
    expect(monthlyForPayoff(loan, [], loan.today, "2026-06-10", 15, undefined)).toBeNull();
  });
});

describe("planStatus", () => {
  const status = (transactions: LoanTransactionRow[], today: string, answers: PlanAnswer[] = [], p = plan()) =>
    planStatus(detail(transactions, today), p, answers);

  it("asks nothing before the first due date", () => {
    const s = status(LOAN, "2026-06-14");
    expect(s.pending).toBeNull();
    expect(s.aheadOre).toBe(0);
    expect(s.next).toEqual({ date: "2026-06-15", amountOre: ore(4_000), extra: false });
  });

  it("asks about a due payment that is not registered", () => {
    const s = status(LOAN, "2026-06-15");
    expect(s.pending).toEqual({ dueDate: "2026-06-15", amountOre: ore(4_000), snoozed: false });
    expect(s.aheadOre).toBe(-ore(4_000));
  });

  it("stops asking once the payment is registered, whoever registered it", () => {
    const s = status([...LOAN, tx("2026-06-16", "repayment", 4_000)], "2026-06-20");
    expect(s.pending).toBeNull();
    expect(s.aheadOre).toBe(0);
  });

  it("asks about the oldest missing payment first, for what is missing", () => {
    // Three due (June, July, August), 5 000 paid: June is covered, July lacks 3 000.
    const s = status([...LOAN, tx("2026-06-15", "repayment", 5_000)], "2026-08-20");
    expect(s.pending).toEqual({ dueDate: "2026-07-15", amountOre: ore(3_000), snoozed: false });
    expect(s.aheadOre).toBe(-ore(7_000));
  });

  it("lets a large payment cover the months that follow", () => {
    const s = status([...LOAN, tx("2026-06-15", "repayment", 12_000)], "2026-08-20");
    expect(s.pending).toBeNull();
    expect(s.aheadOre).toBe(0);
    expect(status([...LOAN, tx("2026-06-15", "repayment", 12_000)], "2026-07-20").aheadOre).toBe(ore(4_000));
  });

  it("ignores repayments from before the plan started", () => {
    const s = status([...LOAN, tx("2026-03-01", "repayment", 50_000)], "2026-06-15");
    expect(s.paidOre).toBe(0);
    expect(s.pending?.dueDate).toBe("2026-06-15");
  });

  it("drops a skipped payment and moves on to the next", () => {
    const skipped: PlanAnswer[] = [{ dueDate: "2026-06-15", status: "skipped", snoozedUntil: null }];
    expect(status(LOAN, "2026-06-20", skipped).pending).toBeNull();
    const later = status(LOAN, "2026-07-15", skipped);
    expect(later.pending?.dueDate).toBe("2026-07-15");
    expect(later.expectedOre).toBe(ore(4_000));
  });

  it("hides a snoozed payment until the date, then asks again", () => {
    const snoozed: PlanAnswer[] = [{ dueDate: "2026-06-15", status: "snoozed", snoozedUntil: "2026-06-18" }];
    expect(status(LOAN, "2026-06-17", snoozed).pending?.snoozed).toBe(true);
    expect(status(LOAN, "2026-06-18", snoozed).pending?.snoozed).toBe(false);
    // Still counted as behind while snoozed.
    expect(status(LOAN, "2026-06-17", snoozed).aheadOre).toBe(-ore(4_000));
  });

  it("never asks for more than is owed, and nothing once the loan is settled", () => {
    const nearlyDone = [tx("2026-01-10", "disbursement", 1_500)];
    expect(status(nearlyDone, "2026-06-15").pending?.amountOre).toBe(ore(1_500));
    const settled = [tx("2026-01-10", "disbursement", 1_500), tx("2026-02-01", "repayment", 1_500)];
    const s = status(settled, "2026-06-15");
    expect(s.pending).toBeNull();
    expect(s.next).toBeNull();
  });
});

describe("upcomingByMonth", () => {
  it("sums what falls after today into the coming months", () => {
    const payments = [
      { date: "2026-11-17", amountOre: 100 }, // today: already due, not ahead
      { date: "2026-11-20", amountOre: 200 },
      { date: "2026-12-15", amountOre: 300 },
      { date: "2026-12-20", amountOre: 50 },
      { date: "2027-02-01", amountOre: 400 },
      { date: "2027-03-01", amountOre: 999 }, // outside the window
    ];
    expect(upcomingByMonth(payments, "2026-11-17", 4)).toEqual([
      { month: "2026-11", amountOre: 200, count: 1 },
      { month: "2026-12", amountOre: 350, count: 2 },
      { month: "2027-01", amountOre: 0, count: 0 },
      { month: "2027-02", amountOre: 400, count: 1 },
    ]);
  });
});
