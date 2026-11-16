"use client";

import { useMemo, useState, useTransition } from "react";
import { importTransactions } from "@/app/(app)/actions";
import { formatDate, formatKr } from "@/lib/format";
import { guessMapping, mapRows, parseDelimited, type ColumnMapping, type Table } from "@/lib/import/table";
import { computeLedger, type Capitalization } from "@/lib/loan-engine";
import type { LoanRateRow, LoanTransactionRow } from "@/lib/loans";
import { ENTRY_LABELS } from "@/lib/labels";
import { Button, Card, ErrorText, Segmented, SelectField } from "./ui";

async function readFile(file: File): Promise<Table> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    return (await readSheet(file)) as Table;
  }
  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    // Norwegian bank exports are often Windows-1252.
    text = new TextDecoder("windows-1252").decode(buffer);
  }
  return parseDelimited(text);
}

const cellPreview = (cell: Table[number][number]) =>
  cell instanceof Date ? cell.toISOString().slice(0, 10) : cell === null || cell === undefined ? "" : String(cell);

export function ImportWizard({
  loanId,
  existing,
  rates,
  capitalization,
  today,
}: {
  loanId: string;
  existing: LoanTransactionRow[];
  rates: LoanRateRow[];
  capitalization: Capitalization;
  today: string;
}) {
  const [pasted, setPasted] = useState("");
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = (next: Table) => {
    if (next.length === 0) return setError("Fann ingen rader.");
    setError(null);
    setTable(next);
    setMapping(guessMapping(next));
  };

  const result = useMemo(
    () => (table && mapping ? mapRows(table, mapping) : null),
    [table, mapping],
  );
  const summary = useMemo(() => {
    if (!result || result.rows.length === 0) return null;
    const sum = (kind: string) =>
      result.rows.filter((r) => r.kind === kind).reduce((total, r) => total + r.amountOre, 0);
    const until = [today, ...result.rows.map((r) => r.date)].sort().at(-1)!;
    const ledger = computeLedger({
      transactions: [...existing, ...result.rows],
      rates,
      capitalization,
      until,
    });
    const dates = result.rows.map((r) => r.date).sort();
    return {
      disbursedOre: sum("disbursement"),
      repaidOre: sum("repayment"),
      balanceOre: ledger.balanceOre,
      from: dates[0],
      to: dates.at(-1)!,
    };
  }, [result, existing, rates, capitalization, today]);

  if (!table || !mapping) {
    return (
      <div className="animate-enter space-y-4 px-4 pb-10">
        <Card className="space-y-4">
          <div>
            <h2 className="font-medium">Lim inn frå reknearket</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Marker radene i Excel (gjerne med overskrifter), kopier, og lim inn her. Du treng dato og beløp.
            </p>
          </div>
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={7}
            spellCheck={false}
            aria-label="Innlimte rader"
            placeholder={"Dato\tBeløp\tTekst\n01.02.2023\t50 000\tFørste uttak"}
            className="w-full rounded-2xl border border-outline bg-surface-lowest p-4 font-mono text-sm outline-none placeholder:text-outline focus:border-primary"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="state-layer inline-flex h-12 cursor-pointer items-center rounded-full border border-outline px-6 text-sm font-medium text-primary">
              Vel fil (.xlsx, .csv)
              <input
                type="file"
                accept=".xlsx,.csv,.tsv,.txt"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    load(await readFile(file));
                  } catch {
                    setError("Klarte ikkje å lese fila. Prøv å lime inn radene i staden.");
                  }
                }}
              />
            </label>
            <Button disabled={pasted.trim() === ""} onClick={() => load(parseDelimited(pasted))}>
              Neste
            </Button>
          </div>
          <ErrorText>{error}</ErrorText>
        </Card>
      </div>
    );
  }

  const width = Math.max(...table.map((row) => row.length));
  const columnName = (index: number) => {
    const header = mapping.hasHeader ? cellPreview(table[0][index]).trim() : "";
    return header || `Kolonne ${index + 1}`;
  };
  const columns = Array.from({ length: width }, (_, index) => index);
  const options = (allowNone: boolean) => (
    <>
      {allowNone && <option value="">Ingen</option>}
      {columns.map((index) => (
        <option key={index} value={index}>
          {columnName(index)}
        </option>
      ))}
    </>
  );
  const update = (patch: Partial<ColumnMapping>) => setMapping({ ...mapping, ...patch });
  const column = (value: string) => (value === "" ? null : Number(value));
  const split = mapping.amount === null;

  return (
    <div className="animate-enter space-y-4 px-4 pb-10">
      <Card className="space-y-4">
        <h2 className="font-medium">Kva står i kolonnane?</h2>
        <Segmented<"single" | "split">
          label="Oppsett for beløp"
          value={split ? "split" : "single"}
          onChange={(next) =>
            next === "single"
              ? update({ amount: mapping.disbursed ?? mapping.repaid ?? columns.find((c) => c !== mapping.date) ?? 0, disbursed: null, repaid: null })
              : update({ amount: null, disbursed: mapping.amount, repaid: null })
          }
          options={[
            { value: "single", label: "Éin beløpskolonne" },
            { value: "split", label: "Uttak og innbetaling kvar for seg" },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Dato" value={mapping.date} onChange={(e) => update({ date: Number(e.target.value) })}>
            {options(false)}
          </SelectField>
          {split ? (
            <>
              <SelectField label="Uttak" value={mapping.disbursed ?? ""} onChange={(e) => update({ disbursed: column(e.target.value) })}>
                {options(true)}
              </SelectField>
              <SelectField label="Innbetaling" value={mapping.repaid ?? ""} onChange={(e) => update({ repaid: column(e.target.value) })}>
                {options(true)}
              </SelectField>
            </>
          ) : (
            <>
              <SelectField label="Beløp" value={mapping.amount ?? ""} onChange={(e) => update({ amount: Number(e.target.value) })}>
                {options(false)}
              </SelectField>
              <SelectField
                label="Positive beløp er"
                value={mapping.positiveIs}
                onChange={(e) => update({ positiveIs: e.target.value as ColumnMapping["positiveIs"] })}
                hint="Negative beløp blir det motsette."
              >
                <option value="disbursement">Uttak (aukar lånet)</option>
                <option value="repayment">Innbetaling (reduserer lånet)</option>
              </SelectField>
            </>
          )}
          <SelectField label="Notat" value={mapping.note ?? ""} onChange={(e) => update({ note: column(e.target.value) })}>
            {options(true)}
          </SelectField>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-(--md-primary)"
            checked={mapping.hasHeader}
            onChange={(event) => update({ hasHeader: event.target.checked })}
          />
          Første rad er overskrifter
        </label>
      </Card>

      <Card className="px-0 pb-2">
        <h2 className="px-5 pb-2 font-medium">
          {result?.rows.length ?? 0} transaksjonar klare
        </h2>
        {summary && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 pb-3 text-sm sm:grid-cols-4">
            <div><dt className="text-on-surface-variant">Periode</dt><dd>{formatDate(summary.from)} – {formatDate(summary.to)}</dd></div>
            <div><dt className="text-on-surface-variant">Uttak</dt><dd className="tabular-nums">{formatKr(summary.disbursedOre, { trimZeros: true })}</dd></div>
            <div><dt className="text-on-surface-variant">Innbetalt</dt><dd className="tabular-nums">{formatKr(summary.repaidOre, { trimZeros: true })}</dd></div>
            <div><dt className="text-on-surface-variant">Saldo etter import</dt><dd className="font-medium tabular-nums">{formatKr(summary.balanceOre, { trimZeros: true })}</dd></div>
          </dl>
        )}
        {result && result.rows.length > 0 && (
          <div className="max-h-80 overflow-auto border-t border-outline-variant">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-low text-left text-on-surface-variant">
                <tr>
                  <th className="px-5 py-2 font-medium">Dato</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 text-right font-medium">Beløp</th>
                  <th className="px-5 py-2 font-medium">Notat</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index} className="border-t border-outline-variant/50">
                    <td className="px-5 py-2 whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="px-2 py-2">{ENTRY_LABELS[row.kind]}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{formatKr(row.amountOre)}</td>
                    <td className="max-w-40 truncate px-5 py-2 text-on-surface-variant">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result && result.skipped.length > 0 && (
          <p className="px-5 pt-3 text-sm text-on-surface-variant">
            Hoppar over {result.skipped.length} {result.skipped.length === 1 ? "rad" : "rader"}:{" "}
            {result.skipped.slice(0, 6).map((s) => `rad ${s.row} (${s.reason.toLowerCase()})`).join(", ")}
            {result.skipped.length > 6 ? " …" : ""}
          </p>
        )}
      </Card>

      {existing.length > 0 && (
        <p className="rounded-2xl bg-tertiary-container px-4 py-3 text-sm text-on-tertiary-container">
          Lånet har alt {existing.length} {existing.length === 1 ? "transaksjon" : "transaksjonar"}. Importen
          legg til nye i tillegg og fjernar ikkje duplikat.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-between gap-3">
        <Button variant="text" disabled={pending} onClick={() => { setTable(null); setMapping(null); }}>
          Tilbake
        </Button>
        <Button
          disabled={pending || !result || result.rows.length === 0}
          onClick={() =>
            startTransition(async () => {
              const response = await importTransactions(
                loanId,
                result!.rows.map((row) => ({ date: row.date, amountOre: row.amountOre, kind: row.kind, note: row.note ?? "" })),
              );
              if (!response.ok) setError(response.error);
            })
          }
        >
          {pending ? "Importerer…" : `Importer ${result?.rows.length ?? 0}`}
        </Button>
      </div>
    </div>
  );
}
