/** Wire format between the chat screen and `/api/chat`. Shared by both sides. */

/** One finished turn. Only text is kept between requests; tool calls live inside a single request. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChatRequest {
  turns: ChatTurn[];
  /** The loan the user opened the chat from, if any. */
  loanId?: string;
}

/** The response body is one JSON event per line. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; label: string }
  | { type: "error"; message: string }
  | { type: "done" };

export const MAX_TURNS = 40;
export const MAX_TURN_CHARS = 4000;

/** Returns a clean request, or null when the body is not a valid conversation. */
export function parseChatRequest(body: unknown): ChatRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { turns, loanId } = body as { turns?: unknown; loanId?: unknown };
  if (!Array.isArray(turns) || turns.length === 0 || turns.length > MAX_TURNS) return null;

  const clean: ChatTurn[] = [];
  for (const [index, turn] of turns.entries()) {
    if (typeof turn !== "object" || turn === null) return null;
    const { role, text } = turn as { role?: unknown; text?: unknown };
    // Turns alternate, starting and ending with the user.
    const expected = index % 2 === 0 ? "user" : "assistant";
    if (role !== expected || typeof text !== "string") return null;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_TURN_CHARS) return null;
    clean.push({ role: expected, text: trimmed });
  }
  if (clean.at(-1)?.role !== "user") return null;

  const validLoanId = typeof loanId === "string" && /^[0-9a-f-]{36}$/i.test(loanId);
  return { turns: clean, ...(validLoanId ? { loanId: loanId as string } : {}) };
}
