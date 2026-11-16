import { describe, expect, it } from "vitest";
import { dueDateInMonth, dueDatesBetween, firstDueOnOrAfter } from "./recurring";

describe("recurring due dates", () => {
  it("clamps to the last day of short months", () => {
    expect(dueDateInMonth(2026, 1, 31)).toBe("2026-02-28");
    expect(dueDateInMonth(2028, 1, 30)).toBe("2028-02-29");
    expect(dueDateInMonth(2026, 3, 31)).toBe("2026-04-30");
    expect(dueDateInMonth(2026, 4, 15)).toBe("2026-05-15");
  });

  it("lists every due date in a range, inclusive", () => {
    expect(dueDatesBetween("2026-08-31", "2026-11-16", 31)).toEqual([
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
    ]);
    expect(dueDatesBetween("2026-11-10", "2026-11-16", 1)).toEqual([]);
    expect(dueDatesBetween("2025-12-15", "2026-02-15", 15)).toEqual([
      "2025-12-15",
      "2026-01-15",
      "2026-02-15",
    ]);
  });

  it("finds the first due date on or after a date", () => {
    expect(firstDueOnOrAfter("2026-11-10", 1)).toBe("2026-12-01");
    expect(firstDueOnOrAfter("2026-11-10", 10)).toBe("2026-11-10");
    expect(firstDueOnOrAfter("2026-12-20", 15)).toBe("2027-01-15");
  });
});
