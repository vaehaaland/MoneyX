import { describe, expect, it } from "vitest";
import { parseAmountToOre, parseDateToIso, formatKr, formatRate } from "../format";
import { guessMapping, mapRows, parseDelimited } from "./table";

describe("parseAmountToOre", () => {
  it.each([
    ["1 234,50", 123450],
    ["1 234,50 kr", 123450],
    ["1.234,50", 123450],
    ["1,234.50", 123450],
    ["1234.5", 123450],
    ["1234", 123400],
    ["1.234", 123400],
    ["1,234", 123400],
    ["12,5", 1250],
    ["0,05", 5],
    ["-500", -50000],
    ["−500,00", -50000],
    ["500-", -50000],
    ["(500)", -50000],
    ["kr 5 000,-", 500000],
    ["1.000.000", 100000000],
    ["4000.00", 400000],
  ])("%s → %i", (input, expected) => {
    expect(parseAmountToOre(input)).toBe(expected);
  });

  it("rejects non-numbers", () => {
    expect(parseAmountToOre("")).toBeNull();
    expect(parseAmountToOre("abc")).toBeNull();
    expect(parseAmountToOre("12.03.2023")).toBeNull();
    expect(parseAmountToOre(null)).toBeNull();
  });

  it("rounds spreadsheet floats", () => {
    expect(parseAmountToOre(1234.5)).toBe(123450);
    expect(parseAmountToOre(0.1 + 0.2)).toBe(30);
  });
});

describe("parseDateToIso", () => {
  it.each([
    ["31.12.2023", "2023-12-31"],
    ["1.2.23", "2023-02-01"],
    ["31/12/2023", "2023-12-31"],
    ["2023-12-31", "2023-12-31"],
    ["2023-12-31T00:00:00", "2023-12-31"],
  ])("%s → %s", (input, expected) => {
    expect(parseDateToIso(input)).toBe(expected);
  });

  it("handles Date objects and Excel serials", () => {
    expect(parseDateToIso(new Date(Date.UTC(2024, 1, 29)))).toBe("2024-02-29");
    expect(parseDateToIso(45292)).toBe("2024-01-01");
  });

  it("rejects impossible dates and plain numbers", () => {
    expect(parseDateToIso("31.02.2023")).toBeNull();
    expect(parseDateToIso("hei")).toBeNull();
    expect(parseDateToIso(5000)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats kroner the Norwegian way", () => {
    expect(formatKr(123450)).toBe("1 234,50 kr");
    expect(formatKr(-500000, { trimZeros: true })).toBe("−5 000 kr");
    expect(formatRate(550)).toBe("5,5 %");
  });
});

describe("parseDelimited", () => {
  it("reads tab-separated text pasted from Excel", () => {
    expect(parseDelimited("Dato\tBeløp\tTekst\n01.02.2023\t1 000,00\tHei\n\n")).toEqual([
      ["Dato", "Beløp", "Tekst"],
      ["01.02.2023", "1 000,00", "Hei"],
    ]);
  });

  it("reads semicolon CSV with quotes and a BOM", () => {
    expect(parseDelimited('﻿Dato;Beløp;Tekst\r\n01.02.2023;"1 000,50";"Sa ""hei""; gjekk"')).toEqual([
      ["Dato", "Beløp", "Tekst"],
      ["01.02.2023", "1 000,50", 'Sa "hei"; gjekk'],
    ]);
  });

  it("reads comma CSV", () => {
    expect(parseDelimited("date,amount\n2023-01-01,100.50")).toEqual([
      ["date", "amount"],
      ["2023-01-01", "100.50"],
    ]);
  });
});

describe("guessMapping and mapRows", () => {
  it("handles a single signed amount column", () => {
    const table = parseDelimited(
      "Dato\tBeløp\tKommentar\n10.01.2023\t100 000\tLån til bil\n01.03.2023\t-5 000\tAvdrag\n",
    );
    const mapping = guessMapping(table);
    expect(mapping).toMatchObject({ hasHeader: true, date: 0, amount: 1, note: 2 });
    const { rows, skipped } = mapRows(table, mapping);
    expect(skipped).toEqual([]);
    expect(rows).toEqual([
      { row: 2, date: "2023-01-10", amountOre: 10000000, kind: "disbursement", note: "Lån til bil" },
      { row: 3, date: "2023-03-01", amountOre: 500000, kind: "repayment", note: "Avdrag" },
    ]);
    expect(mapRows(table, { ...mapping, positiveIs: "repayment" }).rows.map((r) => r.kind)).toEqual([
      "repayment",
      "disbursement",
    ]);
  });

  it("handles separate columns for lent and repaid, and a running balance", () => {
    const table = parseDelimited(
      [
        "Dato;Tekst;Uttak;Innbetalt;Saldo",
        "10.01.2023;Start;50 000;;50 000",
        "01.02.2023;Feb;;2 000;48 000",
        "tull;;;;",
        "01.03.2023;Ingenting;;;48 000",
      ].join("\n"),
    );
    const mapping = guessMapping(table);
    expect(mapping).toMatchObject({ date: 0, amount: null, disbursed: 2, repaid: 3, note: 1 });
    const { rows, skipped } = mapRows(table, mapping);
    expect(rows.map((r) => [r.date, r.kind, r.amountOre])).toEqual([
      ["2023-01-10", "disbursement", 5000000],
      ["2023-02-01", "repayment", 200000],
    ]);
    expect(skipped).toEqual([
      { row: 4, reason: "Manglar gyldig dato" },
      { row: 5, reason: "Manglar beløp" },
    ]);
  });

  it("works without a header and with typed spreadsheet cells", () => {
    const table = [
      [new Date(Date.UTC(2023, 0, 10)), 1000.5, "a"],
      [new Date(Date.UTC(2023, 1, 10)), -200, null],
    ];
    const mapping = guessMapping(table);
    expect(mapping).toMatchObject({ hasHeader: false, date: 0, amount: 1 });
    expect(mapRows(table, mapping).rows.map((r) => [r.date, r.kind, r.amountOre, r.note])).toEqual([
      ["2023-01-10", "disbursement", 100050, "a"],
      ["2023-02-10", "repayment", 20000, null],
    ]);
  });
});
