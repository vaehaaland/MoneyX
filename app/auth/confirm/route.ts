import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { NEXT_COOKIE, safeNextPath } from "@/lib/next-path";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite"];

/** Landing point for the link in the sign-in email. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let signedIn = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    signedIn = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    signedIn = !error;
  }

  // Continue to where the visitor was headed when they asked for the link.
  const next = safeNextPath(request.cookies.get(NEXT_COOKIE)?.value);
  const url = new URL(signedIn ? next : "/login", request.nextUrl.origin);
  if (!signedIn) url.searchParams.set("error", "link");
  const response = NextResponse.redirect(url);
  if (signedIn) response.cookies.delete(NEXT_COOKIE);
  return response;
}
