import "server-only";
import { computeLedger, type Capitalization, type LedgerResult, type TransactionKind } from "./loan-engine";
import { createClient } from "./supabase/server";
import { todayIso } from "./format";

export interface Loan {
  id: string;
  name: string;
  counterpartyName: string | null;
  direction: "borrowed" | "lent";
  startDate: string;
  capitalization: Capitalization;
  archivedAt: string | null;
  isOwner: boolean;
}

export interface LoanTransactionRow {
  id: string;
  date: string;
  amountOre: number;
  kind: TransactionKind;
  note: string | null;
}

export interface LoanRateRow {
  id: string;
  validFrom: string;
  annualRateBp: number;
}

export interface LoanDetail {
  loan: Loan;
  transactions: LoanTransactionRow[];
  rates: LoanRateRow[];
  ledger: LedgerResult;
  /** Transactions dated after today: listed, but not part of the balance. */
  upcoming: LoanTransactionRow[];
  today: string;
}

const LOAN_COLUMNS = "id, owner_id, name, counterparty_name, direction, start_date, capitalization, archived_at";
const TX_COLUMNS = "id, loan_id, date, amount_ore, kind, note";
const RATE_COLUMNS = "id, loan_id, valid_from, annual_rate_bp";

type LoanRecord = {
  id: string;
  owner_id: string;
  name: string;
  counterparty_name: string | null;
  direction: string;
  start_date: string;
  capitalization: string;
  archived_at: string | null;
};

function toLoan(row: LoanRecord, userId: string | null): Loan {
  return {
    id: row.id,
    name: row.name,
    counterpartyName: row.counterparty_name,
    direction: row.direction as Loan["direction"],
    startDate: row.start_date,
    capitalization: row.capitalization as Capitalization,
    archivedAt: row.archived_at,
    isOwner: row.owner_id === userId,
  };
}

const toTx = (t: { id: string; date: string; amount_ore: number; kind: string; note: string | null }): LoanTransactionRow => ({
  id: t.id,
  date: t.date,
  amountOre: t.amount_ore,
  kind: t.kind as TransactionKind,
  note: t.note,
});

const toRate = (r: { id: string; valid_from: string; annual_rate_bp: number }): LoanRateRow => ({
  id: r.id,
  validFrom: r.valid_from,
  annualRateBp: r.annual_rate_bp,
});

function buildDetail(
  loan: Loan,
  transactions: LoanTransactionRow[],
  rates: LoanRateRow[],
  today: string,
): LoanDetail {
  const ledger = computeLedger({
    transactions,
    rates,
    capitalization: loan.capitalization,
    until: today,
  });
  return { loan, transactions, rates, ledger, upcoming: transactions.filter((t) => t.date > today), today };
}

/** Every loan the signed-in user can see, with its current position. */
export async function listLoans(): Promise<LoanDetail[]> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub ?? null;

  const [loans, transactions, rates] = await Promise.all([
    supabase.from("loans").select(LOAN_COLUMNS).order("created_at"),
    supabase.from("loan_transactions").select(TX_COLUMNS).order("date").order("created_at"),
    supabase.from("loan_rates").select(RATE_COLUMNS).order("valid_from"),
  ]);
  const error = loans.error ?? transactions.error ?? rates.error;
  if (error) throw new Error(error.message);

  const today = todayIso();
  return (loans.data ?? []).map((row) =>
    buildDetail(
      toLoan(row, userId),
      (transactions.data ?? []).filter((t) => t.loan_id === row.id).map(toTx),
      (rates.data ?? []).filter((r) => r.loan_id === row.id).map(toRate),
      today,
    ),
  );
}

/** One loan with transactions, rates and computed ledger, or null if not visible. */
export async function getLoan(id: string): Promise<LoanDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub ?? null;

  const [loan, transactions, rates] = await Promise.all([
    supabase.from("loans").select(LOAN_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("loan_transactions").select(TX_COLUMNS).eq("loan_id", id).order("date").order("created_at"),
    supabase.from("loan_rates").select(RATE_COLUMNS).eq("loan_id", id).order("valid_from"),
  ]);
  const error = loan.error ?? transactions.error ?? rates.error;
  if (error) throw new Error(error.message);
  if (!loan.data) return null;

  return buildDetail(
    toLoan(loan.data, userId),
    (transactions.data ?? []).map(toTx),
    (rates.data ?? []).map(toRate),
    todayIso(),
  );
}
