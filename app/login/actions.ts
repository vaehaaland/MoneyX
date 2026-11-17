"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NEXT_COOKIE, safeNextPath } from "@/lib/next-path";
import { createClient } from "@/lib/supabase/server";

export type LoginResult = { ok: true } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendCode(email: string, next?: string): Promise<LoginResult> {
  const address = String(email ?? "").trim().toLowerCase();
  if (!EMAIL.test(address) || address.length > 254) {
    return { ok: false, error: "Skriv inn ei gyldig e-postadresse." };
  }
  const headerList = await headers();
  const origin =
    headerList.get("origin") ??
    `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: address,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/confirm` },
  });
  // The emailed link lands on /auth/confirm without our query string, so the
  // destination travels in a short-lived cookie in this browser instead.
  const destination = safeNextPath(next);
  const cookieStore = await cookies();
  if (destination === "/") cookieStore.delete(NEXT_COOKIE);
  else cookieStore.set(NEXT_COOKIE, destination, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), maxAge: 3600, path: "/" });

  if (error) {
    console.error("signInWithOtp failed:", error.message);
    if (error.status === 429) {
      return { ok: false, error: "For mange forsøk. Vent litt og prøv igjen." };
    }
    return { ok: false, error: "Klarte ikkje å sende e-post. Prøv igjen." };
  }
  return { ok: true };
}

export async function verifyCode(email: string, code: string, next?: string): Promise<LoginResult> {
  const address = String(email ?? "").trim().toLowerCase();
  const token = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6,10}$/.test(token)) return { ok: false, error: "Skriv inn koden frå e-posten." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: address, token, type: "email" });
  if (error) return { ok: false, error: "Koden er feil eller utgått. Prøv igjen." };
  (await cookies()).delete(NEXT_COOKIE);
  redirect(safeNextPath(next));
}
