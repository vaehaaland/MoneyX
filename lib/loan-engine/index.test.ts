import { describe, expect, it } from "vitest";
import { computeLedger, fromDayNumber, toDayNumber, type LoanTransaction } from "./index";

const kr = (n: number) => Math.round(n * 100);
const tx = (
  date: string,
  kind: LoanTransaction["kind"],
  amount: number,
  id?: string,
): LoanTransaction => ({ date, kind, amountOre: kr(amount), id });

describe("dates", () => {
  it("round-trips day numbers", () => {
    expect(fromDayNumber(toDayNumber("2024-02-29"))).toBe("2024-02-29");
    expect(toDayNumber("2024-03-01") - toDayNumber("2024-02-01")).toBe(29);
  });

  it("rejects invalid dates", () => {
    expect(() => toDayNumber("2023-02-30")).toThrow();
    expect(() => toDayNumber("01.02.2023")).toThrow();
  });
});

describe("interest-free loan", () => {
  const transactions = [
    tx("2023-01-10", "disbursement", 100_000),
    tx("2023-03-01", "repayment", 5_000),
    tx("2023-06-15", "disbursement", 20_000),
    tx("2023-07-01", "repayment", 7_500.5),
  ];

  it("is plain balance in and out", () => {
    const r = computeLedger({ transactions, rates: [], capitalization: "none", until: "2026-01-01" });
    expect(r.balanceOre).toBe(kr(107_499.5));
    expect(r.accruedInterestOre).toBe(0);
    expect(r.totals.disbursedOre).toBe(kr(120_000));
    expect(r.totals.repaidPrincipalOre).toBe(kr(12_500.5));
    expect(r.totals.paidInterestOre).toBe(0);
    expect(r.entries.map((e) => e.balanceAfterOre)).toEqual(
      [100_000, 95_000, 115_000, 107_499.5].map(kr),
    );
  });

  it("ignores transactions after `until` and includes the same day", () => {
    const at = (until: string) =>
      computeLedger({ transactions, rates: [], capitalization: "monthly", until }).balanceOre;
    expect(at("2023-02-28")).toBe(kr(100_000));
    expect(at("2023-03-01")).toBe(kr(95_000));
  });

  it("gives the same result regardless of input order", () => {
    const shuffled = [transactions[2], transactions[0], transactions[3], transactions[1]];
    const a = computeLedger({ transactions, rates: [], capitalization: "none", until: "2024-01-01" });
    const b = computeLedger({ transactions: shuffled, rates: [], capitalization: "none", until: "2024-01-01" });
    expect(b.entries.map((e) => e.balanceAfterOre)).toEqual(a.entries.map((e) => e.balanceAfterOre));
  });
});

describe("interest", () => {
  it("accrues ACT/365 on principal", () => {
    const r = computeLedger({
      transactions: [tx("2023-01-01", "disbursement", 100_000)],
      rates: [{ validFrom: "2023-01-01", annualRateBp: 500 }],
      capitalization: "none",
      until: "2024-01-01",
    });
    expect(r.principalOre).toBe(kr(100_000));
    expect(r.accruedInterestOre).toBe(kr(5_000));
    expect(r.balanceOre).toBe(kr(105_000));
    expect(r.currentRateBp).toBe(500);
  });

  it("applies a rate that started before the first transaction", () => {
    const r = computeLedger({
      transactions: [tx("2023-07-01", "disbursement", 36_500)],
      rates: [{ validFrom: "2020-01-01", annualRateBp: 1000 }],
      capitalization: "none",
      until: "2023-07-11",
    });
    expect(r.accruedInterestOre).toBe(kr(100));
  });

  it("splits accrual at a rate change", () => {
    const r = computeLedger({
      transactions: [tx("2023-01-01", "disbursement", 365_000)],
      rates: [
        { validFrom: "2023-01-01", annualRateBp: 0 },
        { validFrom: "2023-02-01", annualRateBp: 400 },
        { validFrom: "2023-03-01", annualRateBp: 800 },
      ],
      capitalization: "none",
      until: "2023-03-11",
    });
    // 28 days at 4 % = 1 120, 10 days at 8 % = 800
    expect(r.accruedInterestOre).toBe(kr(1_920));
    expect(r.entries.filter((e) => e.type === "rate_change").map((e) => e.annualRateBp)).toEqual([
      400, 800,
    ]);
  });

  it("covers interest before principal on repayment", () => {
    const r = computeLedger({
      transactions: [tx("2023-01-01", "disbursement", 365_000), tx("2023-01-11", "repayment", 1_500)],
      rates: [{ validFrom: "2023-01-01", annualRateBp: 1000 }],
      capitalization: "none",
      until: "2023-01-11",
    });
    const repayment = r.entries.at(-1)!;
    expect(repayment.interestPartOre).toBe(kr(1_000));
    expect(repayment.principalPartOre).toBe(kr(500));
    expect(r.principalOre).toBe(kr(364_500));
    expect(r.accruedInterestOre).toBe(0);
    expect(r.totals.paidInterestOre).toBe(kr(1_000));
  });

  it("keeps unpaid interest when a repayment is smaller than what is due", () => {
    const r = computeLedger({
      transactions: [tx("2023-01-01", "disbursement", 365_000), tx("2023-01-11", "repayment", 400)],
      rates: [{ validFrom: "2023-01-01", annualRateBp: 1000 }],
      capitalization: "none",
      until: "2023-01-11",
    });
    expect(r.principalOre).toBe(kr(365_000));
    expect(r.accruedInterestOre).toBe(kr(600));
  });

  it("does not compound without capitalization", () => {
    const r = computeLedger({
      transactions: [tx("2022-01-01", "disbursement", 100_000)],
      rates: [{ validFrom: "2022-01-01", annualRateBp: 1000 }],
      capitalization: "none",
      until: "2024-01-01",
    });
    expect(r.balanceOre).toBe(kr(120_000));
  });

  it("compounds yearly on 1 January", () => {
    const r = computeLedger({
      transactions: [tx("2022-01-01", "disbursement", 100_000)],
      rates: [{ validFrom: "2022-01-01", annualRateBp: 1000 }],
      capitalization: "yearly",
      until: "2024-01-01",
    });
    expect(r.principalOre).toBe(kr(121_000));
    expect(r.accruedInterestOre).toBe(0);
    expect(r.totals.capitalizedInterestOre).toBe(kr(21_000));
    expect(r.entries.filter((e) => e.type === "capitalization").map((e) => e.date)).toEqual([
      "2023-01-01",
      "2024-01-01",
    ]);
  });

  it("compounds monthly on the 1st", () => {
    const r = computeLedger({
      transactions: [tx("2023-01-15", "disbursement", 365_000)],
      rates: [{ validFrom: "2023-01-01", annualRateBp: 1000 }],
      capitalization: "monthly",
      until: "2023-03-01",
    });
    // 17 days in January: 1 700,00. February: 366 700 × 10 % × 28/365 = 2 813,04
    expect(r.entries.filter((e) => e.type === "capitalization").map((e) => e.interestPartOre)).toEqual(
      [kr(1_700), kr(2_813.04)],
    );
    expect(r.principalOre).toBe(kr(369_513.04));
  });

  it("does not charge interest on an overpaid loan", () => {
    const r = computeLedger({
      transactions: [tx("2023-01-01", "disbursement", 1_000), tx("2023-02-01", "repayment", 1_500)],
      rates: [{ validFrom: "2023-02-01", annualRateBp: 1000 }],
      capitalization: "none",
      until: "2024-02-01",
    });
    expect(r.balanceOre).toBe(kr(-500));
    expect(r.accruedInterestOre).toBe(0);
  });
});

describe("other transaction kinds", () => {
  it("handles fees and signed adjustments", () => {
    const r = computeLedger({
      transactions: [
        tx("2023-01-01", "disbursement", 10_000),
        tx("2023-01-02", "fee", 250),
        tx("2023-01-03", "adjustment", -1_000),
      ],
      rates: [],
      capitalization: "none",
      until: "2023-02-01",
    });
    expect(r.balanceOre).toBe(kr(9_250));
    expect(r.totals.feesOre).toBe(kr(250));
    expect(r.totals.disbursedOre).toBe(kr(10_000));
  });

  it("rejects negative non-adjustments and zero amounts", () => {
    const run = (t: LoanTransaction) =>
      computeLedger({ transactions: [t], rates: [], capitalization: "none", until: "2024-01-01" });
    expect(() => run({ date: "2023-01-01", kind: "repayment", amountOre: -100 })).toThrow();
    expect(() => run({ date: "2023-01-01", kind: "disbursement", amountOre: 0 })).toThrow();
  });
});

describe("series and empty input", () => {
  it("returns an empty position with no transactions", () => {
    const r = computeLedger({
      transactions: [],
      rates: [{ validFrom: "2020-01-01", annualRateBp: 300 }],
      capitalization: "none",
      until: "2024-01-01",
    });
    expect(r.balanceOre).toBe(0);
    expect(r.entries).toEqual([]);
    expect(r.currentRateBp).toBe(300);
  });

  it("has a before and after point for each jump and ends at `until`", () => {
    const r = computeLedger({
      transactions: [
        tx("2023-01-01", "disbursement", 1_000),
        tx("2023-01-01", "disbursement", 2_000),
        tx("2023-02-01", "repayment", 500),
      ],
      rates: [],
      capitalization: "none",
      until: "2023-03-01",
    });
    expect(r.series).toEqual([
      { date: "2023-01-01", balanceOre: kr(1_000) },
      { date: "2023-01-01", balanceOre: kr(3_000) },
      { date: "2023-02-01", balanceOre: kr(3_000) },
      { date: "2023-02-01", balanceOre: kr(2_500) },
      { date: "2023-03-01", balanceOre: kr(2_500) },
    ]);
  });

  it("shows accrued interest as a slope up to each event", () => {
    const r = computeLedger({
      transactions: [tx("2023-01-01", "disbursement", 365_000), tx("2023-01-11", "repayment", 1_000)],
      rates: [{ validFrom: "2023-01-01", annualRateBp: 1000 }],
      capitalization: "none",
      until: "2023-01-21",
    });
    expect(r.series).toEqual([
      { date: "2023-01-01", balanceOre: kr(365_000) },
      { date: "2023-01-11", balanceOre: kr(366_000) },
      { date: "2023-01-11", balanceOre: kr(365_000) },
      { date: "2023-01-21", balanceOre: kr(366_000) },
    ]);
  });
});
