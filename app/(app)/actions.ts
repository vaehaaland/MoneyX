"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { toDayNumber, type Capitalization, type TransactionKind } from "@/lib/loan-engine";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const KINDS: TransactionKind[] = ["disbursement", "repayment", "fee", "adjustment"];
const CAPITALIZATIONS: Capitalization[] = ["none", "monthly", "yearly"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ORE = 1_000_000_000_00; // 1 mrd. kr

const fail = (error: string): ActionResult => ({ ok: false, error });

function isDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const day = toDayNumber(value);
    return day >= toDayNumber("1970-01-01") && day <= toDayNumber("2100-01-01");
  } catch {
    return false;
  }
}

function checkAmount(amountOre: unknown, kind: TransactionKind): string | null {
  if (typeof amountOre !== "number" || !Number.isSafeInteger(amountOre) || amountOre === 0) {
    return "Skriv inn eit beløp.";
  }
  if (Math.abs(amountOre) > MAX_ORE) return "Beløpet er for stort.";
  if (amountOre < 0 && kind !== "adjustment") return "Beløpet må vere positivt.";
  return null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, max);
  return text === "" ? null : text;
}

function dbError(message: string): ActionResult {
  console.error("Database error:", message);
  return fail("Noko gjekk gale ved lagring. Prøv igjen.");
}

export interface LoanInput {
  name: string;
  counterpartyName: string;
  direction: "borrowed" | "lent";
  startDate: string;
  capitalization: Capitalization;
  /** Opening rate in basis points; 0 for an interest-free loan. */
  annualRateBp: number;
}

function checkLoan(input: Omit<LoanInput, "annualRateBp">): string | null {
  if (!cleanText(input.name, 120)) return "Gi lånet eit namn.";
  if (input.direction !== "borrowed" && input.direction !== "lent") return "Vel kven som skuldar.";
  if (!isDate(input.startDate)) return "Vel ein gyldig startdato.";
  if (!CAPITALIZATIONS.includes(input.capitalization)) return "Ugyldig val for rente.";
  return null;
}

function checkRate(bp: unknown): bp is number {
  return typeof bp === "number" && Number.isInteger(bp) && bp >= 0 && bp <= 100_000;
}

export async function createLoan(input: LoanInput): Promise<ActionResult> {
  const problem = checkLoan(input);
  if (problem) return fail(problem);
  if (!checkRate(input.annualRateBp)) return fail("Renta må vere mellom 0 og 1000 %.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .insert({
      name: cleanText(input.name, 120)!,
      counterparty_name: cleanText(input.counterpartyName, 120),
      direction: input.direction,
      start_date: input.startDate,
      capitalization: input.capitalization,
    })
    .select("id")
    .single();
  if (error) return dbError(error.message);

  if (input.annualRateBp > 0) {
    const rate = await supabase
      .from("loan_rates")
      .insert({ loan_id: data.id, valid_from: input.startDate, annual_rate_bp: input.annualRateBp });
    if (rate.error) return dbError(rate.error.message);
  }
  redirect(`/loans/${data.id}`);
}

export async function updateLoan(
  loanId: string,
  input: Omit<LoanInput, "annualRateBp">,
): Promise<ActionResult> {
  if (!UUID.test(loanId)) return fail("Ukjent lån.");
  const problem = checkLoan(input);
  if (problem) return fail(problem);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .update({
      name: cleanText(input.name, 120)!,
      counterparty_name: cleanText(input.counterpartyName, 120),
      direction: input.direction,
      start_date: input.startDate,
      capitalization: input.capitalization,
    })
    .eq("id", loanId)
    .select("id");
  if (error) return dbError(error.message);
  if (data.length === 0) return fail("Du har ikkje tilgang til å endre dette lånet.");
  refresh();
  return { ok: true };
}

export async function deleteLoan(loanId: string): Promise<ActionResult> {
  if (!UUID.test(loanId)) return fail("Ukjent lån.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("loans").delete().eq("id", loanId).select("id");
  if (error) return dbError(error.message);
  if (data.length === 0) return fail("Du har ikkje tilgang til å slette dette lånet.");
  redirect("/");
}

export interface TransactionInput {
  id?: string;
  date: string;
  amountOre: number;
  kind: TransactionKind;
  note: string;
}

export async function saveTransaction(loanId: string, input: TransactionInput): Promise<ActionResult> {
  if (!UUID.test(loanId)) return fail("Ukjent lån.");
  if (!KINDS.includes(input.kind)) return fail("Vel ein type.");
  if (!isDate(input.date)) return fail("Vel ein gyldig dato.");
  const problem = checkAmount(input.amountOre, input.kind);
  if (problem) return fail(problem);

  const supabase = await createClient();
  const values = {
    date: input.date,
    amount_ore: input.amountOre,
    kind: input.kind,
    note: cleanText(input.note, 500),
  };
  if (input.id) {
    if (!UUID.test(input.id)) return fail("Ukjend transaksjon.");
    const { data, error } = await supabase
      .from("loan_transactions")
      .update(values)
      .eq("id", input.id)
      .eq("loan_id", loanId)
      .select("id");
    if (error) return dbError(error.message);
    if (data.length === 0) return fail("Du har ikkje tilgang til å endre denne.");
  } else {
    const { error } = await supabase.from("loan_transactions").insert({ loan_id: loanId, ...values });
    if (error) return dbError(error.message);
  }
  refresh();
  return { ok: true };
}

export async function deleteTransaction(loanId: string, id: string): Promise<ActionResult> {
  if (!UUID.test(loanId) || !UUID.test(id)) return fail("Ukjend transaksjon.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_transactions")
    .delete()
    .eq("id", id)
    .eq("loan_id", loanId)
    .select("id");
  if (error) return dbError(error.message);
  if (data.length === 0) return fail("Du har ikkje tilgang til å slette denne.");
  refresh();
  return { ok: true };
}

export async function importTransactions(
  loanId: string,
  rows: Omit<TransactionInput, "id">[],
): Promise<ActionResult> {
  if (!UUID.test(loanId)) return fail("Ukjent lån.");
  if (!Array.isArray(rows) || rows.length === 0) return fail("Ingen rader å importere.");
  if (rows.length > 5000) return fail("For mange rader. Del opp importen.");
  for (const [index, row] of rows.entries()) {
    if (!KINDS.includes(row.kind) || !isDate(row.date) || checkAmount(row.amountOre, row.kind)) {
      return fail(`Rad ${index + 1} er ugyldig.`);
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("loan_transactions").insert(
    rows.map((row) => ({
      loan_id: loanId,
      date: row.date,
      amount_ore: row.amountOre,
      kind: row.kind,
      note: cleanText(row.note, 500),
    })),
  );
  if (error) return dbError(error.message);
  redirect(`/loans/${loanId}`);
}

export async function saveRate(
  loanId: string,
  input: { validFrom: string; annualRateBp: number },
): Promise<ActionResult> {
  if (!UUID.test(loanId)) return fail("Ukjent lån.");
  if (!isDate(input.validFrom)) return fail("Vel ein gyldig dato.");
  if (!checkRate(input.annualRateBp)) return fail("Renta må vere mellom 0 og 1000 %.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("loan_rates")
    .upsert(
      { loan_id: loanId, valid_from: input.validFrom, annual_rate_bp: input.annualRateBp },
      { onConflict: "loan_id,valid_from" },
    );
  if (error) return dbError(error.message);
  refresh();
  return { ok: true };
}

export async function deleteRate(loanId: string, id: string): Promise<ActionResult> {
  if (!UUID.test(loanId) || !UUID.test(id)) return fail("Ukjend sats.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_rates")
    .delete()
    .eq("id", id)
    .eq("loan_id", loanId)
    .select("id");
  if (error) return dbError(error.message);
  if (data.length === 0) return fail("Du har ikkje tilgang til å slette denne.");
  refresh();
  return { ok: true };
}

export interface RecurringInput {
  kind: "repayment" | "disbursement";
  amountOre: number;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  note: string;
}

/** Adds a recurring payment and immediately posts any occurrences already due. */
export async function createRecurring(loanId: string, input: RecurringInput): Promise<ActionResult> {
  if (!UUID.test(loanId)) return fail("Ukjent lån.");
  if (input.kind !== "repayment" && input.kind !== "disbursement") return fail("Vel ein type.");
  const problem = checkAmount(input.amountOre, input.kind);
  if (problem) return fail(problem);
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) {
    return fail("Vel ein dag mellom 1 og 31.");
  }
  if (!isDate(input.startDate) || input.startDate < "2000-01-01") return fail("Vel ein gyldig startdato.");
  if (input.endDate !== null && (!isDate(input.endDate) || input.endDate < input.startDate)) {
    return fail("Sluttdatoen må vere etter startdatoen.");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("loan_recurring_payments").insert({
    loan_id: loanId,
    kind: input.kind,
    amount_ore: input.amountOre,
    day_of_month: input.dayOfMonth,
    start_date: input.startDate,
    end_date: input.endDate,
    note: cleanText(input.note, 500),
    // Replaced by a database trigger; the column has no default.
    next_due: input.startDate,
  });
  if (error) return dbError(error.message);

  const posted = await supabase.rpc("post_due_recurring_payments", { p_loan_id: loanId });
  if (posted.error) return dbError(posted.error.message);
  refresh();
  return { ok: true };
}

/** Stops a recurring payment. Transactions it already posted are kept. */
export async function deleteRecurring(loanId: string, id: string): Promise<ActionResult> {
  if (!UUID.test(loanId) || !UUID.test(id)) return fail("Ukjend fast betaling.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_recurring_payments")
    .delete()
    .eq("id", id)
    .eq("loan_id", loanId)
    .select("id");
  if (error) return dbError(error.message);
  if (data.length === 0) return fail("Du har ikkje tilgang til å stoppe denne.");
  refresh();
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
