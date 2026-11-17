/**
 * Where to send someone after signing in. Only paths inside the app are
 * accepted, so a crafted link cannot bounce a fresh session to another site.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || next.length > 500) return "/";
  // One leading slash, no scheme, no backslashes or control characters.
  if (!/^\/(?![/\\])[^\\\s\u0000-\u001f]*$/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/auth/")) return "/";
  return next;
}

/** Cookie that carries the destination through the emailed sign-in link. */
export const NEXT_COOKIE = "moneyx_next";
