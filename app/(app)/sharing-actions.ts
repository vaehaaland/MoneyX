"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { hashInviteToken, isInviteToken, newInviteToken, parseInviteResult, type InviteRole } from "@/lib/sharing";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string): ActionResult => ({ ok: false, error });

function dbError(message: string): ActionResult {
  console.error("Database error:", message);
  return fail("Noko gjekk gale ved lagring. Prøv igjen.");
}

/**
 * Creates an invite link for a loan. The token is returned once, to be shown
 * to the owner; only its hash is stored, so the link cannot be looked up later.
 */
export async function createInvite(
  loanId: string,
  role: InviteRole,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (!UUID.test(loanId)) return { ok: false, error: "Ukjent lån." };
  if (role !== "viewer" && role !== "editor") return { ok: false, error: "Vel kva den andre skal kunne gjere." };

  const token = newInviteToken();
  const supabase = await createClient();
  const { error } = await supabase
    .from("loan_invites")
    .insert({ loan_id: loanId, role, token_hash: hashInviteToken(token) });
  if (error) {
    // Row level security rejects everyone but the owner.
    if (error.code === "42501") return { ok: false, error: "Berre eigaren kan dele lånet." };
    console.error("Database error:", error.message);
    return { ok: false, error: "Noko gjekk gale ved lagring. Prøv igjen." };
  }
  refresh();
  return { ok: true, token };
}

/** Withdraws an invite link that has not been used. */
export async function revokeInvite(loanId: string, inviteId: string): Promise<ActionResult> {
  if (!UUID.test(loanId) || !UUID.test(inviteId)) return fail("Ukjend invitasjon.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_invites")
    .delete()
    .eq("id", inviteId)
    .eq("loan_id", loanId)
    .select("id");
  if (error) return dbError(error.message);
  if (data.length === 0) return fail("Du har ikkje tilgang til å trekkje denne tilbake.");
  refresh();
  return { ok: true };
}

/** The owner removes someone's access. What they registered stays on the loan. */
export async function removeMember(loanId: string, userId: string): Promise<ActionResult> {
  if (!UUID.test(loanId) || !UUID.test(userId)) return fail("Ukjend person.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_members")
    .delete()
    .eq("loan_id", loanId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return dbError(error.message);
  if (data.length === 0) return fail("Du har ikkje tilgang til å fjerne denne personen.");
  refresh();
  return { ok: true };
}

/** A member gives up their own access. */
export async function leaveLoan(loanId: string): Promise<ActionResult> {
  if (!UUID.test(loanId)) return fail("Ukjent lån.");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return fail("Du er logga ut.");
  const { data, error } = await supabase
    .from("loan_members")
    .delete()
    .eq("loan_id", loanId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return dbError(error.message);
  if (data.length === 0) return fail("Du er ikkje med på dette lånet.");
  redirect("/");
}

/** Accepts an invite link and opens the loan. */
export async function acceptInvite(token: string): Promise<ActionResult> {
  if (!isInviteToken(token)) return fail("Lenka er ikkje gyldig.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_loan_invite", { p_token: token });
  if (error) return dbError(error.message);

  const result = parseInviteResult(data);
  if (result.loanId && ["accepted", "already_member", "own_loan"].includes(result.status)) {
    // Everything already on the loan is history, not news, for someone who just joined.
    if (result.status === "accepted") await supabase.rpc("mark_loan_seen", { p_loan_id: result.loanId });
    redirect(`/loans/${result.loanId}`);
  }
  if (result.status === "used") return fail("Lenka er alt brukt. Be om ei ny.");
  if (result.status === "expired") return fail("Lenka er utgått. Be om ei ny.");
  return fail("Lenka er ikkje gyldig.");
}

/**
 * Records that the signed-in user has the loan open now. Deliberately does not
 * refresh: what was new on arrival stays marked for this visit.
 */
export async function markLoanSeen(loanId: string): Promise<void> {
  if (!UUID.test(loanId)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_loan_seen", { p_loan_id: loanId });
  if (error) console.error("mark_loan_seen failed:", error.message);
}

/** Sets the name the other party sees instead of the email address. */
export async function updateDisplayName(name: string): Promise<ActionResult> {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { name: clean } });
  if (error) {
    console.error("updateUser failed:", error.message);
    return fail("Klarte ikkje å lagre namnet. Prøv igjen.");
  }
  refresh();
  return { ok: true };
}
