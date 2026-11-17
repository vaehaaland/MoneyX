import Anthropic from "@anthropic-ai/sdk";
import { parseChatRequest, type ChatEvent } from "@/lib/chat/protocol";
import { runChat } from "@/lib/chat/run";
import { getLoan } from "@/lib/loans";
import { getUserId } from "@/lib/supabase/server";

// Tool rounds plus a streamed answer can take a while.
export const maxDuration = 300;

const json = (status: number, error: string) => Response.json({ error }, { status });

/** User-facing text for a failed model call. Details go to the server log only. */
function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return "Chatten er ikkje sett opp rett: API-nøkkelen blei avvist.";
  }
  if (error instanceof Anthropic.RateLimitError) return "For mange spørsmål på kort tid. Vent litt og prøv att.";
  if (error instanceof Anthropic.APIConnectionError) return "Fekk ikkje kontakt med Claude. Prøv att.";
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) {
    return "Claude er utilgjengeleg akkurat no. Prøv att om litt.";
  }
  return "Noko gjekk gale. Prøv att.";
}

/** Streams one chat turn as newline-delimited JSON events. */
export async function POST(request: Request) {
  if (!(await getUserId())) return json(401, "unauthorized");
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return json(503, "not_configured");

  const chat = parseChatRequest(await request.json().catch(() => null));
  if (!chat) return json(400, "invalid_request");

  // Loaded with the user's session, so a loan they cannot see is simply ignored.
  const focus = chat.loanId ? await getLoan(chat.loanId) : null;
  const focusLoan = focus ? { id: focus.loan.id, name: focus.loan.name } : null;

  const client = new Anthropic();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runChat({ client, turns: chat.turns, focusLoan, signal: request.signal })) {
          send(event);
        }
      } catch (error) {
        // The user pressed stop or left the page: nothing to report.
        if (!request.signal.aborted) {
          console.error("chat failed", error);
          send({ type: "error", message: describeError(error) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
