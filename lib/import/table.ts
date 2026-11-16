import { parseAmountToOre, parseDateToIso } from "../format";
import type { TransactionKind } from "../loan-engine";

export type Cell = string | number | Date | boolean | null | undefined;
export type Table = Cell[][];

/** Splits pasted or uploaded delimited text (tab, semicolon or comma) into rows. */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLines = clean.split("\n").slice(0, 10).join("\n");
  const count = (ch: string) => firstLines.split(ch).length - 1;
  const delimiter = count("\t") > 0 ? "\t" : count(";") >= count(",") && count(";") > 0 ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

export interface ColumnMapping {
  hasHeader: boolean;
  date: number;
  /** A single signed amount column… */
  amount: number | null;
  /** …or separate columns for money lent out and money paid back. */
  disbursed: number | null;
  repaid: number | null;
  note: number | null;
  /** With a single amount column: what a positive number means. */
  positiveIs: "disbursement" | "repayment";
}

const cellText = (cell: Cell) => (cell === null || cell === undefined ? "" : String(cell).trim());
const cellAmount = (cell: Cell) =>
  typeof cell === "number" ? parseAmountToOre(cell) : parseAmountToOre(cellText(cell));
const cellDate = (cell: Cell) =>
  typeof cell === "boolean" ? null : parseDateToIso(cell as string | number | Date | null | undefined);

const HEADER_HINTS = {
  date: /dato|date|tid/i,
  amount: /bel[øo]p|amount|sum|kroner|kr\b/i,
  disbursed: /uttak|utl[åa]n|l[åa]nt|ut\b|utbetal|debet|ny gjeld/i,
  repaid: /innbetal|nedbetal|betalt|avdrag|inn\b|kredit/i,
  note: /tekst|notat|beskriv|kommentar|forklaring|merknad|note|hva/i,
};

/** Guesses which columns hold what from the header names and cell contents. */
export function guessMapping(table: Table): ColumnMapping {
  const width = Math.max(0, ...table.map((r) => r.length));
  const first = table[0] ?? [];
  const hasHeader =
    first.length > 0 &&
    first.every((c) => cellDate(c) === null) &&
    first.filter((c) => cellAmount(c) !== null).length === 0;
  const body = hasHeader ? table.slice(1) : table;
  const sample = body.slice(0, 50);
  const share = (col: number, test: (c: Cell) => boolean) =>
    sample.length === 0 ? 0 : sample.filter((r) => test(r[col])).length / sample.length;

  const columns = Array.from({ length: width }, (_, i) => i);
  const header = (col: number) => (hasHeader ? cellText(first[col]) : "");
  const byHint = (hint: RegExp, taken: (number | null)[]) =>
    columns.find((c) => !taken.includes(c) && hint.test(header(c))) ?? null;

  const date =
    columns.find((c) => share(c, (v) => cellDate(v) !== null) > 0.6) ??
    byHint(HEADER_HINTS.date, []) ??
    0;
  const numeric = columns.filter(
    (c) => c !== date && share(c, (v) => cellText(v) === "" || cellAmount(v) !== null) > 0.8
      && share(c, (v) => cellAmount(v) !== null) > 0,
  );

  let disbursed = byHint(HEADER_HINTS.disbursed, [date]);
  let repaid = byHint(HEADER_HINTS.repaid, [date, disbursed]);
  if (disbursed !== null && !numeric.includes(disbursed)) disbursed = null;
  if (repaid !== null && !numeric.includes(repaid)) repaid = null;

  let amount: number | null = null;
  if (disbursed === null || repaid === null) {
    disbursed = null;
    repaid = null;
    const hinted = byHint(HEADER_HINTS.amount, [date]);
    amount = hinted !== null && numeric.includes(hinted) ? hinted : (numeric[0] ?? null);
  }

  const used = [date, amount, disbursed, repaid];
  const note =
    byHint(HEADER_HINTS.note, used) ??
    columns.find(
      (c) => !used.includes(c) && !numeric.includes(c) && share(c, (v) => cellText(v) !== "") > 0.2,
    ) ??
    null;

  return { hasHeader, date, amount, disbursed, repaid, note, positiveIs: "disbursement" };
}

export interface ImportedRow {
  /** 1-based row number in the source table. */
  row: number;
  date: string;
  amountOre: number;
  kind: Extract<TransactionKind, "disbursement" | "repayment">;
  note: string | null;
}

export interface ImportResult {
  rows: ImportedRow[];
  skipped: { row: number; reason: string }[];
}

/** Turns a table into loan transactions using the given column mapping. */
export function mapRows(table: Table, mapping: ColumnMapping): ImportResult {
  const result: ImportResult = { rows: [], skipped: [] };
  const start = mapping.hasHeader ? 1 : 0;
  const other = mapping.positiveIs === "disbursement" ? "repayment" : "disbursement";

  for (let i = start; i < table.length; i++) {
    const cells = table[i];
    const rowNumber = i + 1;
    if (cells.every((c) => cellText(c) === "")) continue;

    const date = cellDate(cells[mapping.date]);
    if (!date) {
      result.skipped.push({ row: rowNumber, reason: "Manglar gyldig dato" });
      continue;
    }
    const note = mapping.note === null ? null : cellText(cells[mapping.note]).slice(0, 500) || null;
    const push = (amountOre: number, kind: ImportedRow["kind"]) =>
      result.rows.push({ row: rowNumber, date, amountOre, kind, note });

    if (mapping.amount !== null) {
      const amount = cellAmount(cells[mapping.amount]);
      if (amount === null || amount === 0) {
        result.skipped.push({ row: rowNumber, reason: "Manglar beløp" });
        continue;
      }
      push(Math.abs(amount), amount > 0 ? mapping.positiveIs : other);
    } else {
      const out = mapping.disbursed === null ? null : cellAmount(cells[mapping.disbursed]);
      const back = mapping.repaid === null ? null : cellAmount(cells[mapping.repaid]);
      if (!out && !back) {
        result.skipped.push({ row: rowNumber, reason: "Manglar beløp" });
        continue;
      }
      if (out) push(Math.abs(out), "disbursement");
      if (back) push(Math.abs(back), "repayment");
    }
  }
  return result;
}
