"use client";

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { MAX_TURN_CHARS, MAX_TURNS, type ChatEvent, type ChatRequest, type ChatTurn } from "@/lib/chat/protocol";
import { Icon } from "./icon";

interface Message extends ChatTurn {
  /** Set when the answer ended in an error; shown under the text. */
  error?: string;
}

const SUGGESTIONS = [
  "Kor mykje står att på lånet?",
  "Kor mykje er betalt ned i år?",
  "Når er lånet nedbetalt med 3 000 kr i månaden?",
  "Kva må eg betale i månaden for å vere ferdig om to år?",
];

const ERRORS: Record<string, string> = {
  unauthorized: "Du er logga ut. Last sida på nytt og logg inn.",
  not_configured: "Chatten er ikkje sett opp enno: serveren manglar ANTHROPIC_API_KEY.",
  invalid_request: "Meldinga kunne ikkje sendast. Start ein ny samtale og prøv att.",
};

// ── Conversation store ──────────────────────────────────────────────────────
// Conversations are kept per loan for the browser tab's lifetime: in memory,
// mirrored to sessionStorage so a reload or a trip to another screen keeps them.

const storageKey = (loanId: string | undefined) => `moneyx.chat.${loanId ?? "all"}`;
const NO_MESSAGES: Message[] = [];
const conversations = new Map<string, Message[]>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function readConversation(key: string): Message[] {
  if (!conversations.has(key)) {
    let stored: unknown = null;
    try {
      stored = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    } catch {
      // Private mode or corrupt data: start empty.
    }
    conversations.set(key, Array.isArray(stored) ? stored : []);
  }
  return conversations.get(key)!;
}

function writeConversation(key: string, change: (current: Message[]) => Message[]) {
  const next = change(readConversation(key));
  conversations.set(key, next);
  try {
    sessionStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage unavailable or full: the chat still works for this visit.
  }
  listeners.forEach((listener) => listener());
}

/** Renders the model's plain text, with `**bold**` as the only markup. */
function AnswerText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index} className="font-medium">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function ChatView({ loan }: { loan: { id: string; name: string } | null }) {
  const key = storageKey(loan?.id);
  // The server renders an empty chat; the stored one appears after hydration.
  const messages = useSyncExternalStore(subscribe, () => readConversation(key), () => NO_MESSAGES);
  const loaded = useSyncExternalStore(subscribe, () => true, () => false);
  const [draft, setDraft] = useState("");
  /** Null when idle; otherwise what the assistant is doing right now. */
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = status !== null;

  // Stop a running answer when the screen is left.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest text in view while it streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status]);

  /** Applies a change to the answer currently being written (always the last message). */
  const updateAnswer = (change: (answer: Message) => Message) =>
    writeConversation(key, (current) => {
      // The conversation may have been cleared while the answer was streaming.
      const answer = current.at(-1);
      return answer?.role === "assistant" ? [...current.slice(0, -1), change(answer)] : current;
    });

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;

    // Failed answers are dropped from what the model sees, together with their question.
    const history = messages.filter((m, i) => !m.error && !(m.role === "user" && messages[i + 1]?.error));
    const turns: ChatTurn[] = [...history.map(({ role, text }) => ({ role, text })), { role: "user" as const, text }].slice(
      -(MAX_TURNS - 1),
    );
    const request: ChatRequest = { turns, ...(loan ? { loanId: loan.id } : {}) };

    setDraft("");
    writeConversation(key, (current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);
    setStatus("Tenkjer");
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const code = await response
          .json()
          .then((body: { error?: string }) => body.error)
          .catch(() => undefined);
        throw new Error(ERRORS[code ?? ""] ?? "Noko gjekk gale. Prøv att.");
      }

      // One JSON event per line; a chunk can end in the middle of a line.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "text") {
            setStatus("Skriv");
            updateAnswer((answer) => ({ ...answer, text: answer.text + event.delta }));
          } else if (event.type === "tool") {
            setStatus(event.label);
          } else if (event.type === "error") {
            updateAnswer((answer) => ({ ...answer, error: event.message }));
          }
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        const message = error instanceof Error && error.message ? error.message : "Noko gjekk gale. Prøv att.";
        updateAnswer((answer) => ({ ...answer, error: message }));
      }
    } finally {
      // An answer that never got any text is not worth keeping in the history.
      updateAnswer((answer) => (answer.text.trim() || answer.error ? { ...answer, text: answer.text.trim() } : { ...answer, error: "Stoppa." }));
      abortRef.current = null;
      setStatus(null);
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter makes a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(draft);
    }
  };
  const reset = () => {
    abortRef.current?.abort();
    writeConversation(key, () => []);
  };

  return (
    <div className="flex min-h-[calc(100dvh-9rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] flex-col md:min-h-[calc(100dvh-4rem)]">
      <div className="flex-1 space-y-3 px-4 pb-4" aria-live="polite">
        {loaded && messages.length === 0 && (
          <div className="animate-enter space-y-4 pt-6">
            <p className="text-on-surface-variant">
              Spør om saldo, innbetalingar og renter, eller få rekna ut kor lang tid nedbetalinga tek. Svara byggjer på
              dei same tala som resten av appen, og ingenting blir endra herfrå.
            </p>
            <ul className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => void ask(suggestion)}
                    className="state-layer rounded-2xl border border-outline-variant px-4 py-2 text-left text-sm"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message, index) => {
          const writing = busy && index === messages.length - 1;
          return message.role === "user" ? (
            <div key={index} className="flex justify-end">
              <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-primary-container px-4 py-2.5 whitespace-pre-wrap text-on-primary-container [overflow-wrap:anywhere]">
                {message.text}
              </p>
            </div>
          ) : (
            <div key={index} className="max-w-[92%] space-y-2">
              {message.text && (
                <p className="rounded-3xl rounded-bl-lg bg-surface-low px-4 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <AnswerText text={message.text} />
                </p>
              )}
              {writing && (
                <p className="flex items-center gap-2 px-1 text-sm text-on-surface-variant">
                  <span className="size-2 animate-pulse rounded-full bg-primary" />
                  {status}…
                </p>
              )}
              {message.error && !writing && (
                <p role="alert" className="rounded-2xl bg-error-container px-4 py-2 text-sm text-on-error-container">
                  {message.error}
                </p>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] flex items-end gap-2 bg-surface px-4 pt-2 pb-3 md:bottom-0"
      >
        {messages.length > 0 && (
          <button
            type="button"
            onClick={reset}
            aria-label="Ny samtale"
            title="Ny samtale"
            className="state-layer inline-flex size-12 shrink-0 items-center justify-center rounded-full text-on-surface-variant"
          >
            <Icon name="delete" />
          </button>
        )}
        <label className="min-w-0 flex-1">
          <span className="sr-only">Spørsmål</span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={MAX_TURN_CHARS}
            placeholder={loan ? `Spør om ${loan.name}` : "Spør om låna dine"}
            className="block max-h-40 min-h-12 w-full resize-none rounded-3xl bg-surface-highest px-5 py-3 text-base text-on-surface outline-none [field-sizing:content] placeholder:text-on-surface-variant focus:ring-2 focus:ring-primary"
          />
        </label>
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            aria-label="Stopp"
            title="Stopp"
            className="state-layer inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-highest text-on-surface"
          >
            <Icon name="stop" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send"
            title="Send"
            className="state-layer inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary disabled:opacity-40"
          >
            <Icon name="send" />
          </button>
        )}
      </form>
    </div>
  );
}
