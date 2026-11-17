import { createHash, randomBytes } from "node:crypto";

/**
 * Invite links. The token only ever exists in the link the owner passes on;
 * the database stores its SHA-256, which `private.invite_token_hash` in the
 * sharing migration computes the same way.
 */

export type InviteRole = "viewer" | "editor";

const TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** 192 random bits, URL-safe. */
export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const ROLE_LABELS: Record<"owner" | InviteRole, string> = {
  owner: "Eigar",
  editor: "Kan registrere",
  viewer: "Kan berre sjå",
};

/** Result of `loan_invite_preview` / `accept_loan_invite`. */
export type InviteStatus = "open" | "accepted" | "own_loan" | "already_member" | "used" | "expired" | "invalid";

export interface InvitePreview {
  status: InviteStatus;
  loanId: string | null;
  loanName: string | null;
  role: InviteRole | null;
  invitedBy: string | null;
}

const STATUSES: InviteStatus[] = ["open", "accepted", "own_loan", "already_member", "used", "expired", "invalid"];

/** Reads the JSON the database functions return, trusting nothing about its shape. */
export function parseInviteResult(json: unknown): InvitePreview {
  const data = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : null);
  const status = STATUSES.find((s) => s === data.status) ?? "invalid";
  const role = text("role");
  return {
    status,
    loanId: text("loan_id"),
    loanName: text("loan_name"),
    role: role === "viewer" || role === "editor" ? role : null,
    invitedBy: text("invited_by"),
  };
}
