import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { LedgerEntryType } from "../loan-engine";
import { getLoan, listLoans, type LoanDetail } from "../loans";
import { parseDateToIso } from "../format";
import { loanOverview, loanSummary, loanTimeline, simulateRepayment, TIMELINE_MAX_LIMIT } from "./loan-data";

/**
 * Read-only tools the chat model can call. Each one loads data through
 * `lib/loans`, which uses the signed-in user's session, so row level security
 * decides what the model can see.
 */

const ENTRY_TYPES: LedgerEntryType[] = ["disbursement", "repayment", "fee", "adjustment", "capitalization", "rate_change"];

const LOAN_ID = { type: "string", description: "The loan's id, from list_loans." } as const;
const DATE = (what: string) => ({ type: "string", description: `${what} ISO date, YYYY-MM-DD.` }) as const;

// `eager_input_streaming` streams tool input as it is generated; the API then
// skips validation, so `runTool` validates every field itself.
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_loans",
    description:
      "List every loan the user can see with its current balance, who owes whom and the current interest rate. Call this first to find a loan_id.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_loan",
    description:
      "Current position of one loan: balance split into principal and accrued interest, lifetime totals (disbursed, repaid, interest paid, fees), interest rate history, recurring payments and future-dated transactions.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { loan_id: LOAN_ID },
      required: ["loan_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_loan_transactions",
    description:
      "The loan's timeline: disbursements, repayments, fees, adjustments, interest capitalizations and rate changes, each with the balance afterwards. Filter by date range and type. Returns sums over every matching entry, so use those instead of adding amounts yourself.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        loan_id: LOAN_ID,
        from: DATE("Earliest"),
        to: DATE("Latest"),
        types: {
          type: "array",
          items: { type: "string", enum: ENTRY_TYPES },
          description: "Only these entry types. Omit for all.",
        },
        limit: { type: "integer", description: `Maximum entries to return (default 50, max ${TIMELINE_MAX_LIMIT}).` },
        newest_first: { type: "boolean", description: "Default true." },
      },
      required: ["loan_id"],
      additionalProperties: false,
    },
  },
  {
    name: "simulate_repayment",
    description:
      "Project the loan forward from today's balance without changing anything. With no options it follows the loan's existing recurring payments. Give monthly_payment_kr to try a fixed monthly amount, or payoff_by to get the monthly amount needed to be done by a date. Returns the payoff date, number of payments, total paid, interest cost and the balance at each new year.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        loan_id: LOAN_ID,
        monthly_payment_kr: { type: "number", description: "Fixed monthly repayment in kroner. Replaces existing recurring repayments." },
        payoff_by: DATE("Target payoff"),
        day_of_month: { type: "integer", description: "Day of month the monthly payment falls on (1-31). Defaults to today's day." },
        annual_rate_percent: { type: "number", description: "Assume this annual interest rate from today, e.g. 4.5. Omit to use the loan's own rates." },
        extra_payments: {
          type: "array",
          description: "One-off extra repayments.",
          items: {
            type: "object",
            properties: { date: DATE("Payment"), amount_kr: { type: "number" } },
            required: ["date", "amount_kr"],
            additionalProperties: false,
          },
        },
      },
      required: ["loan_id"],
      additionalProperties: false,
    },
  },
];

/** Short Norwegian status line shown in the chat while a tool runs. */
export const TOOL_LABELS: Record<string, string> = {
  list_loans: "Hentar låna dine",
  get_loan: "Hentar lånet",
  list_loan_transactions: "Les transaksjonane",
  simulate_repayment: "Reknar på nedbetaling",
};

// ── Input validation ────────────────────────────────────────────────────────

class ToolInputError extends Error {}

type Input = Record<string, unknown>;

function asObject(input: unknown): Input {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ToolInputError("Input must be an object.");
  }
  return input as Input;
}

function optionalDate(input: Input, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  const iso = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateToIso(value) : null;
  if (!iso) throw new ToolInputError(`${key} must be a date as YYYY-MM-DD.`);
  return iso;
}

function optionalNumber(input: Input, key: string, min: number, max: number, integer = false): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new ToolInputError(`${key} must be ${integer ? "a whole number" : "a number"} between ${min} and ${max}.`);
  }
  return value;
}

async function requireLoan(input: Input): Promise<LoanDetail> {
  const id = input.loan_id;
  const detail = typeof id === "string" ? await getLoan(id) : null;
  if (!detail) throw new ToolInputError("No loan with that loan_id. Call list_loans to get valid ids.");
  return detail;
}

const MAX_KR = 1_000_000_000;

// ── Dispatch ────────────────────────────────────────────────────────────────

async function execute(name: string, raw: unknown): Promise<unknown> {
  const input = asObject(raw);
  switch (name) {
    case "list_loans":
      return { loans: (await listLoans()).map(loanOverview) };

    case "get_loan":
      return loanSummary(await requireLoan(input));

    case "list_loan_transactions": {
      const detail = await requireLoan(input);
      const types = input.types;
      if (types !== undefined && (!Array.isArray(types) || !types.every((t) => ENTRY_TYPES.includes(t)))) {
        throw new ToolInputError(`types must be a list of: ${ENTRY_TYPES.join(", ")}.`);
      }
      return loanTimeline(detail, {
        from: optionalDate(input, "from"),
        to: optionalDate(input, "to"),
        types: types as LedgerEntryType[] | undefined,
        // Anything above the maximum is capped by `loanTimeline`.
        limit: optionalNumber(input, "limit", 1, 1_000_000, true),
        newestFirst: typeof input.newest_first === "boolean" ? input.newest_first : undefined,
      });
    }

    case "simulate_repayment": {
      const detail = await requireLoan(input);
      const extras = input.extra_payments;
      if (extras !== undefined && !Array.isArray(extras)) throw new ToolInputError("extra_payments must be a list.");
      const extraPayments = ((extras as unknown[] | undefined) ?? []).slice(0, 50).map((item) => {
        const extra = asObject(item);
        const date = optionalDate(extra, "date");
        const amountKr = optionalNumber(extra, "amount_kr", 0.01, MAX_KR);
        if (!date || amountKr === undefined) throw new ToolInputError("Each extra payment needs date and amount_kr.");
        return { date, amountKr };
      });
      const payoffBy = optionalDate(input, "payoff_by");
      if (payoffBy && payoffBy <= detail.today) throw new ToolInputError(`payoff_by must be after today (${detail.today}).`);
      return simulateRepayment(detail, {
        monthlyPaymentKr: optionalNumber(input, "monthly_payment_kr", 0, MAX_KR),
        dayOfMonth: optionalNumber(input, "day_of_month", 1, 31, true),
        annualRatePercent: optionalNumber(input, "annual_rate_percent", 0, 100),
        payoffBy,
        extraPayments,
      });
    }

    default:
      throw new ToolInputError(`Unknown tool: ${name}`);
  }
}

/** Runs one tool call and returns the `tool_result` content for it. */
export async function runTool(name: string, input: unknown): Promise<{ content: string; isError: boolean }> {
  try {
    return { content: JSON.stringify(await execute(name, input)), isError: false };
  } catch (error) {
    // Input mistakes go back to the model so it can correct itself; anything
    // else stays generic so internals never reach the model or the user.
    const message = error instanceof ToolInputError ? error.message : "The tool failed. Try again or tell the user it is unavailable.";
    if (!(error instanceof ToolInputError)) console.error(`chat tool ${name} failed`, error);
    return { content: message, isError: true };
  }
}
