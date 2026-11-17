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
  /** The signed-in user's access: the owner and editors can add and change transactions. */
  role: LoanRole;
  canWrite: boolean;
}

export type LoanRole = "owner" | "editor" | "viewer";

/** Someone with access to a loan: the owner or a member. */
export interface LoanPerson {
  userId: string;
  /** The name they chose on the account page, or their email. */
  name: string;
  email: string;
  role: LoanRole;
  isMe: boolean;
  joinedAt: string;
}

export interface LoanTransactionRow {
  id: string;
  date: string;
  amountOre: number;
  kind: TransactionKind;
  note: string | null;
  /** Posted automatically by a recurring payment. */
  recurring: boolean;
  /** Who registered it, when that was someone other than the signed-in user. */
  addedBy: string | null;
  /** Registered by someone else since the signed-in user last opened the loan. */
  isNew: boolean;
}

export interface RecurringPaymentRow {
  id: string;
  kind: "repayment" | "disbursement";
  amountOre: number;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  note: string | null;
  /** Next date it will be posted; past `endDate` when the rule has finished. */
  nextDue: string;
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
  recurring: RecurringPaymentRow[];
  ledger: LedgerResult;
  /** Transactions dated after today: listed, but not part of the balance. */
  upcoming: LoanTransactionRow[];
  today: string;
  /** Owner first, then members. */
  people: LoanPerson[];
  /** Transactions others have registered since the signed-in user last opened the loan. */
  newCount: number;
}

const LOAN_COLUMNS = "id, owner_id, name, counterparty_name, direction, start_date, capitalization, archived_at";
const TX_COLUMNS = "id, loan_id, date, amount_ore, kind, note, recurring_id, created_by, created_at";
const RECURRING_COLUMNS =
  "id, loan_id, kind, amount_ore, day_of_month, start_date, end_date, note, next_due";
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

type PersonRecord = {
  loan_id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  joined_at: string;
};

const ROLE_ORDER: Record<LoanRole, number> = { owner: 0, editor: 1, viewer: 2 };

function toPeople(rows: PersonRecord[], userId: string | null): LoanPerson[] {
  return rows
    .map((p) => ({
      userId: p.user_id,
      name: p.display_name ?? p.email ?? "Ukjend",
      email: p.email ?? "",
      role: p.role as LoanRole,
      isMe: p.user_id === userId,
      joinedAt: p.joined_at,
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt.localeCompare(b.joinedAt));
}

/**
 * The loan as the signed-in user sees it. The row is stored from the owner's
 * side, so for a member the direction is mirrored and the counterparty is the
 * owner: "du skuldar" for one is "du har til gode" for the other.
 */
function toLoan(row: LoanRecord, people: LoanPerson[], userId: string | null): Loan {
  const isOwner = row.owner_id === userId;
  const role = isOwner ? "owner" : (people.find((p) => p.isMe)?.role ?? "viewer");
  const direction = row.direction as Loan["direction"];
  return {
    id: row.id,
    name: row.name,
    counterpartyName: isOwner ? row.counterparty_name : (people.find((p) => p.role === "owner")?.name ?? null),
    direction: isOwner ? direction : direction === "borrowed" ? "lent" : "borrowed",
    startDate: row.start_date,
    capitalization: row.capitalization as Capitalization,
    archivedAt: row.archived_at,
    isOwner,
    role,
    canWrite: role !== "viewer",
  };
}

type TxRecord = {
  id: string;
  date: string;
  amount_ore: number;
  kind: string;
  note: string | null;
  recurring_id: string | null;
  created_by: string | null;
  created_at: string;
};

/** Maps a transaction row, marking what other people added and what is new since `lastSeenAt`. */
function toTx(t: TxRecord, people: LoanPerson[], userId: string | null, lastSeenAt: string | null): LoanTransactionRow {
  const byOther = t.created_by !== null && t.created_by !== userId;
  return {
    id: t.id,
    date: t.date,
    amountOre: t.amount_ore,
    kind: t.kind as TransactionKind,
    note: t.note,
    recurring: t.recurring_id !== null,
    addedBy: byOther ? (people.find((p) => p.userId === t.created_by)?.name ?? null) : null,
    // Timestamps come back in differing precision, so compare as instants.
    isNew: byOther && (lastSeenAt === null || Date.parse(t.created_at) > Date.parse(lastSeenAt)),
  };
}

const toRecurring = (r: {
  id: string;
  kind: string;
  amount_ore: number;
  day_of_month: number;
  start_date: string;
  end_date: string | null;
  note: string | null;
  next_due: string;
}): RecurringPaymentRow => ({
  id: r.id,
  kind: r.kind as RecurringPaymentRow["kind"],
  amountOre: r.amount_ore,
  dayOfMonth: r.day_of_month,
  startDate: r.start_date,
  endDate: r.end_date,
  note: r.note,
  nextDue: r.next_due,
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
  recurring: RecurringPaymentRow[],
  people: LoanPerson[],
  today: string,
): LoanDetail {
  const ledger = computeLedger({
    transactions,
    rates,
    capitalization: loan.capitalization,
    until: today,
  });
  return {
    loan,
    transactions,
    rates,
    recurring,
    ledger,
    upcoming: transactions.filter((t) => t.date > today),
    today,
    people,
    newCount: transactions.filter((t) => t.isNew).length,
  };
}

/** Every loan the signed-in user can see, with its current position. */
export async function listLoans(): Promise<LoanDetail[]> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub ?? null;

  const [loans, transactions, rates, recurring, people, views] = await Promise.all([
    supabase.from("loans").select(LOAN_COLUMNS).order("created_at"),
    supabase.from("loan_transactions").select(TX_COLUMNS).order("date").order("created_at"),
    supabase.from("loan_rates").select(RATE_COLUMNS).order("valid_from"),
    supabase.from("loan_recurring_payments").select(RECURRING_COLUMNS).order("created_at"),
    supabase.rpc("loan_people"),
    supabase.from("loan_views").select("loan_id, last_seen_at"),
  ]);
  const error = loans.error ?? transactions.error ?? rates.error ?? recurring.error ?? people.error ?? views.error;
  if (error) throw new Error(error.message);

  const today = todayIso();
  return (loans.data ?? []).map((row) => {
    const loanPeople = toPeople((people.data ?? []).filter((p) => p.loan_id === row.id), userId);
    const lastSeenAt = (views.data ?? []).find((v) => v.loan_id === row.id)?.last_seen_at ?? null;
    return buildDetail(
      toLoan(row, loanPeople, userId),
      (transactions.data ?? []).filter((t) => t.loan_id === row.id).map((t) => toTx(t, loanPeople, userId, lastSeenAt)),
      (rates.data ?? []).filter((r) => r.loan_id === row.id).map(toRate),
      (recurring.data ?? []).filter((r) => r.loan_id === row.id).map(toRecurring),
      loanPeople,
      today,
    );
  });
}

/** One loan with transactions, rates and computed ledger, or null if not visible. */
export async function getLoan(id: string): Promise<LoanDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub ?? null;

  const [loan, transactions, rates, recurring, people, view] = await Promise.all([
    supabase.from("loans").select(LOAN_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("loan_transactions").select(TX_COLUMNS).eq("loan_id", id).order("date").order("created_at"),
    supabase.from("loan_rates").select(RATE_COLUMNS).eq("loan_id", id).order("valid_from"),
    supabase.from("loan_recurring_payments").select(RECURRING_COLUMNS).eq("loan_id", id).order("created_at"),
    supabase.rpc("loan_people", { p_loan_id: id }),
    supabase.from("loan_views").select("last_seen_at").eq("loan_id", id).maybeSingle(),
  ]);
  const error = loan.error ?? transactions.error ?? rates.error ?? recurring.error ?? people.error ?? view.error;
  if (error) throw new Error(error.message);
  if (!loan.data) return null;

  const loanPeople = toPeople(people.data ?? [], userId);
  const lastSeenAt = view.data?.last_seen_at ?? null;
  return buildDetail(
    toLoan(loan.data, loanPeople, userId),
    (transactions.data ?? []).map((t) => toTx(t, loanPeople, userId, lastSeenAt)),
    (rates.data ?? []).map(toRate),
    (recurring.data ?? []).map(toRecurring),
    loanPeople,
    todayIso(),
  );
}

export interface LoanInviteRow {
  id: string;
  role: "viewer" | "editor";
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

/** Invite links for a loan that nobody has used yet. Only the owner gets any rows. */
export async function listOpenInvites(loanId: string): Promise<LoanInviteRow[]> {
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_invites")
    .select("id, role, created_at, expires_at")
    .eq("loan_id", loanId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const now = Date.now();
  return data.map((invite) => ({
    id: invite.id,
    role: invite.role as LoanInviteRow["role"],
    createdAt: invite.created_at,
    expiresAt: invite.expires_at,
    expired: Date.parse(invite.expires_at) <= now,
  }));
}
