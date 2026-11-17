/**
 * Due dates for monthly recurring payments. Mirrors
 * `private.recurring_due_date` in the database, which does the posting.
 */

/** The due date in the given month; days past the month's end fall on its last day. */
export function dueDateInMonth(year: number, monthIndex: number, dayOfMonth: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(dayOfMonth, lastDay))).toISOString().slice(0, 10);
}

/** Every due date from `from` to `to`, both inclusive (ISO dates). */
export function dueDatesBetween(from: string, to: string, dayOfMonth: number): string[] {
  const dates: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7)) - 1;
  for (;;) {
    const due = dueDateInMonth(year, month, dayOfMonth);
    if (due > to) break;
    if (due >= from) dates.push(due);
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return dates;
}

/** The first due date on or after `from`. */
export function firstDueOnOrAfter(from: string, dayOfMonth: number): string {
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7)) - 1;
  const due = dueDateInMonth(year, month, dayOfMonth);
  return due >= from ? due : dueDateInMonth(month === 11 ? year + 1 : year, (month + 1) % 12, dayOfMonth);
}
