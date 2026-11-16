import type { IconName } from "@/components/icon";
import type { Capitalization, LedgerEntryType } from "./loan-engine";

export const ENTRY_LABELS: Record<LedgerEntryType, string> = {
  disbursement: "Uttak",
  repayment: "Innbetaling",
  fee: "Gebyr",
  adjustment: "Justering",
  capitalization: "Renter lagt til",
  rate_change: "Ny rentesats",
};

export const ENTRY_ICONS: Record<LedgerEntryType, IconName> = {
  disbursement: "up",
  repayment: "down",
  fee: "receipt",
  adjustment: "edit",
  capitalization: "trend",
  rate_change: "percent",
};

export const CAPITALIZATION_LABELS: Record<Capitalization, string> = {
  none: "Står for seg sjølv",
  monthly: "Blir lagt til lånet kvar månad",
  yearly: "Blir lagt til lånet kvart år",
};

/** "Du skuldar Kari" / "Kari skuldar deg" for a positive balance. */
export function balanceLabel(
  direction: "borrowed" | "lent",
  counterparty: string | null,
  balanceOre: number,
): string {
  const who = counterparty?.trim();
  const iOwe = (direction === "borrowed") === balanceOre >= 0;
  if (balanceOre === 0) return "Lånet er gjort opp";
  if (iOwe) return who ? `Du skuldar ${who}` : "Du skuldar";
  return who ? `${who} skuldar deg` : "Du har til gode";
}
