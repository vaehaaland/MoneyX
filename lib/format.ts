const NBSP = " ";

const krFormatter = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const krWholeFormatter = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("nb-NO", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

/** 123450 → "1 234,50 kr". Drops ",00" when `trimZeros` is set. */
export function formatKr(ore: number, options: { trimZeros?: boolean; sign?: boolean } = {}): string {
  const whole = options.trimZeros && ore % 100 === 0;
  const body = (whole ? krWholeFormatter : krFormatter).format(Math.abs(ore) / 100);
  const sign = ore < 0 ? "−" : options.sign && ore > 0 ? "+" : "";
  return `${sign}${body}${NBSP}kr`;
}

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(`${iso}T00:00:00Z`));
}

export function formatMonth(iso: string): string {
  return monthFormatter.format(new Date(`${iso}T00:00:00Z`));
}

/** 550 → "5,5 %" */
export function formatRate(bp: number): string {
  return `${(bp / 100).toLocaleString("nb-NO", { maximumFractionDigits: 2 })}${NBSP}%`;
}

/** Today's date in Norway as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(now);
}

/**
 * Parses a human-typed amount to øre. Accepts Norwegian ("1 234,50",
 * "1.234,50") and English ("1,234.50", "1234.5") notation, currency markers,
 * a leading or trailing minus and accounting parentheses. Returns null when
 * the text is not a number.
 */
export function parseAmountToOre(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  let text = input
    .replace(/[\s  ']/g, "")
    .replace(/kr\.?|nok|,-$/gi, "")
    .replace(/[−–—]/g, "-");
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-") || text.endsWith("-")) {
    negative = !negative;
    text = text.replace(/^-|-$/g, "");
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let decimalIndex = -1;
  if (lastComma !== -1 && lastDot !== -1) {
    decimalIndex = Math.max(lastComma, lastDot);
  } else if (lastComma !== -1 || lastDot !== -1) {
    const index = Math.max(lastComma, lastDot);
    const separator = text[index];
    const occurrences = text.split(separator).length - 1;
    const digitsAfter = text.length - index - 1;
    // A single separator followed by exactly three digits is a thousands
    // separator ("1.234"); anything else is a decimal separator.
    if (occurrences === 1 && digitsAfter !== 3) decimalIndex = index;
  }

  const rawInteger = decimalIndex === -1 ? text : text.slice(0, decimalIndex);
  const fractionPart = decimalIndex === -1 ? "" : text.slice(decimalIndex + 1);
  // The integer part is plain digits or consistently grouped in threes.
  if (!/^(\d*|\d{1,3}(\.\d{3})+|\d{1,3}(,\d{3})+)$/.test(rawInteger)) return null;
  if (!/^\d*$/.test(fractionPart)) return null;
  const integerPart = rawInteger.replace(/[.,]/g, "");
  if (fractionPart.length > 2) {
    const value = Math.round(Number(`${integerPart || "0"}.${fractionPart}`) * 100);
    return negative ? -value : value;
  }
  const ore = Number(integerPart || "0") * 100 + Number(fractionPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(ore)) return null;
  return negative ? -ore : ore;
}

/**
 * Parses a date as written in Norwegian bank exports and spreadsheets to
 * YYYY-MM-DD: "31.12.2023", "31.12.23", "31/12/2023", "2023-12-31", a Date,
 * or an Excel serial number.
 */
export function parseDateToIso(input: string | number | Date | null | undefined): string | null {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input.toISOString().slice(0, 10);
  }
  if (typeof input === "number") {
    if (input < 20_000 || input > 80_000) return null; // Excel serials for 1954–2119
    return new Date(Math.round((input - 25_569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const text = input.trim();
  let year: number, month: number, day: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text);
    if (!match) return null;
    [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (year < 100) year += year < 70 ? 2000 : 1900;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}
