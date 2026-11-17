import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";
import { hashInviteToken, isInviteToken, newInviteToken, parseInviteResult } from "./sharing";

describe("invite tokens", () => {
  it("are 32 URL-safe characters and differ each time", () => {
    const tokens = new Set(Array.from({ length: 50 }, newInviteToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(isInviteToken(token)).toBe(true);
  });

  it("rejects anything that is not a token", () => {
    for (const value of ["", "short", "a".repeat(33), `${"a".repeat(31)}/`, `${"a".repeat(31)} `, null, 42]) {
      expect(isInviteToken(value)).toBe(false);
    }
  });

  it("hashes like the database does (hex SHA-256 of the UTF-8 text)", () => {
    // Same value as `select encode(sha256(convert_to('abc', 'UTF8')), 'hex')`.
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashInviteToken(newInviteToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("parseInviteResult", () => {
  it("reads a preview", () => {
    expect(
      parseInviteResult({ status: "open", loan_id: "abc", loan_name: "Lån", role: "editor", invited_by: "Kari" }),
    ).toEqual({ status: "open", loanId: "abc", loanName: "Lån", role: "editor", invitedBy: "Kari" });
  });

  it("falls back to invalid for anything unexpected", () => {
    const invalid = { status: "invalid", loanId: null, loanName: null, role: null, invitedBy: null };
    expect(parseInviteResult(null)).toEqual(invalid);
    expect(parseInviteResult("open")).toEqual(invalid);
    expect(parseInviteResult({ status: "admin", role: "owner", loan_id: 7 })).toEqual(invalid);
  });
});

describe("safeNextPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeNextPath("/invite/abc")).toBe("/invite/abc");
    expect(safeNextPath("/chat?loan=1")).toBe("/chat?loan=1");
  });

  it("sends everything else home", () => {
    for (const value of [
      undefined,
      "",
      "invite/abc",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "/a b",
      "/a\nb",
      "/login",
      "/login?next=/x",
      "/auth/confirm",
      `/${"a".repeat(600)}`,
    ]) {
      expect(safeNextPath(value)).toBe("/");
    }
  });
});
