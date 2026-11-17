"use server";

import { refresh } from "next/cache";
import { fromDayNumber, toDayNumber } from "@/lib/loan-engine";
import { getLoan } from "@/lib/loans";
import type { PlanExtra } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ORE = 1_000_000_000_00; // 1 mrd. kr
/** "Ikkje enno" asks again after this many days. */
const SNOOZE_DAYS = 3;

const fail = (error: string): ActionResult => ({ ok: false, error });

function dbError(error: { code?: string; message: string }): ActionResult {
  // Row level security: viewers and strangers cannot write.
  if (error.code === "42501") return fail("Du har ikkje tilgang til å endre dette lånet.");
  console.error("Database error:", error.message);
  return fail("Noko gjekk gale ved lagring. Prøv igjen.");
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const day = toDayNumber(value);
    return day >= toDayNumber("2000-01-01") && day <= toDayNumber("2100-01-01");
  } catch {
    return false;
  }
}

const isAmount = (value: unknown, min: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= MAX_ORE;

export interface PlanInput {
  name: string;
  monthlyOre: number;
  dayOfMonth: number;
  startDate: string;
  /** Null: use the loan's own rates. */
  assumedRateBp: number | null;
  extras: PlanExtra[];
  /** Make this the plan the app follows up on. */
  activate: boolean;
}

export async function createPlan(loanId: string, input: PlanInput): Promise<ActionResult> {
  if (!UUID.test(loanId)) return fail("Ukjent lån.");
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return fail("Gi planen eit namn.");
  if (!isAmount(input.monthlyOre, 0)) return fail("Skriv inn eit beløp per månad.");
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) {
    return fail("Vel ein dag mellom 1 og 31.");
  }
  if (!isDate(input.startDate)) return fail("Vel ein gyldig startdato.");
  if (input.assumedRateBp !== null && !(Number.isInteger(input.assumedRateBp) && input.assumedRateBp >= 0 && input.assumedRateBp <= 100_000)) {
    return fail("Renta må vere mellom 0 og 1000 %.");
  }
  if (!Array.isArray(input.extras) || input.extras.length > 50) return fail("For mange ekstra innbetalingar.");
  for (const extra of input.extras) {
    if (!isDate(extra?.date) || !isAmount(extra?.amountOre, 1)) return fail("Ei ekstra innbetaling er ugyldig.");
    if (extra.date < input.startDate) return fail("Ekstra innbetalingar kan ikkje liggje før startdatoen.");
  }
  if (input.monthlyOre === 0 && input.extras.length === 0) return fail("Planen må ha minst éi betaling.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_plans")
    .insert({
      loan_id: loanId,
      name,
      monthly_amount_ore: input.monthlyOre,
      day_of_month: input.dayOfMonth,
      start_date: input.startDate,
      assumed_rate_bp: input.assumedRateBp,
      extra_payments: input.extras.map((extra) => ({ date: extra.date, amount_ore: extra.amountOre })),
    })
    .select("id")
    .single();
  if (error) return dbError(error);

  if (input.activate) {
    const activated = await supabase.rpc("set_active_loan_plan", { p_loan_id: loanId, p_plan_id: data.id });
    if (activated.error) return dbError(activated.error);
  }
  refresh();
  return { ok: true };
}

export async function deletePlan(loanId: string, planId: string): Promise<ActionResult> {
  if (!UUID.test(loanId) || !UUID.test(planId)) return fail("Ukjend plan.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("loan_plans").delete().eq("id", planId).eq("loan_id", loanId).select("id");
  if (error) return dbError(error);
  if (data.length === 0) return fail("Du har ikkje tilgang til å slette denne planen.");
  refresh();
  return { ok: true };
}

/** Chooses the plan the app follows up on, or none when `planId` is null. */
export async function setActivePlan(loanId: string, planId: string | null): Promise<ActionResult> {
  if (!UUID.test(loanId) || (planId !== null && !UUID.test(planId))) return fail("Ukjend plan.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_active_loan_plan", {
    p_loan_id: loanId,
    ...(planId ? { p_plan_id: planId } : {}),
  });
  if (error) return error.code === "P0002" ? fail("Fann ikkje planen.") : dbError(error);
  refresh();
  return { ok: true };
}

/**
 * Loads the planned payment the app is currently asking about. The amount and
 * date always come from the server's own calculation, never from the client.
 */
async function pendingPayment(loanId: string, dueDate: string) {
  if (!UUID.test(loanId) || !isDate(dueDate)) return null;
  const detail = await getLoan(loanId);
  const active = detail?.activePlan;
  if (!detail || !active?.status.pending || active.status.pending.dueDate !== dueDate) return null;
  return { detail, plan: active.plan, pending: active.status.pending };
}

const STALE = "Denne betalinga er alt handtert. Last sida på nytt.";

/** "Ja": registers the planned payment as a repayment on its due date. */
export async function confirmPlannedPayment(loanId: string, dueDate: string): Promise<ActionResult> {
  const found = await pendingPayment(loanId, dueDate);
  if (!found) return fail(STALE);
  const supabase = await createClient();
  const { error } = await supabase.from("loan_transactions").insert({
    loan_id: loanId,
    date: found.pending.dueDate,
    amount_ore: found.pending.amountOre,
    kind: "repayment",
    note: "Etter plan",
  });
  if (error) return dbError(error);
  refresh();
  return { ok: true };
}

/** Stores an answer other than yes for the pending payment. */
async function answerPlannedPayment(loanId: string, dueDate: string, status: "skipped" | "snoozed"): Promise<ActionResult> {
  const found = await pendingPayment(loanId, dueDate);
  if (!found) return fail(STALE);
  const supabase = await createClient();
  const { error } = await supabase.from("loan_plan_occurrences").upsert(
    {
      plan_id: found.plan.id,
      loan_id: loanId,
      due_date: dueDate,
      status,
      snoozed_until: status === "snoozed" ? fromDayNumber(toDayNumber(found.detail.today) + SNOOZE_DAYS) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan_id,due_date" },
  );
  if (error) return dbError(error);
  refresh();
  return { ok: true };
}

/** "Ikkje enno": asks again in a few days. */
export async function snoozePlannedPayment(loanId: string, dueDate: string): Promise<ActionResult> {
  return answerPlannedPayment(loanId, dueDate, "snoozed");
}

/** "Hopp over": this payment will not be made, and the plan stops counting it. */
export async function skipPlannedPayment(loanId: string, dueDate: string): Promise<ActionResult> {
  return answerPlannedPayment(loanId, dueDate, "skipped");
}
