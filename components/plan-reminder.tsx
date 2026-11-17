"use client";

import { useState, useTransition, type ReactNode } from "react";
import { confirmPlannedPayment, skipPlannedPayment, snoozePlannedPayment } from "@/app/(app)/plan-actions";
import { formatDate, formatKr } from "@/lib/format";
import type { Loan } from "@/lib/loans";
import type { PlanStatus } from "@/lib/plan";
import { Button, ErrorText } from "./ui";

/**
 * Asks about the oldest planned payment that has not been registered.
 * "Ja" registers it with one tap; the other answers only change when the
 * question comes back.
 */
export function PlanReminder({
  loan,
  pending,
  showLoanName = false,
  other,
}: {
  loan: Pick<Loan, "id" | "name" | "direction">;
  pending: NonNullable<PlanStatus["pending"]>;
  /** On the front page, where several loans can ask at once. */
  showLoanName?: boolean;
  /** The "Anna beløp" control: opens the transaction sheet, or links to the loan. */
  other: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = (action: (loanId: string, dueDate: string) => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action(loan.id, pending.dueDate);
      if (!result.ok) setError(result.error);
    });
  // The one who owes pays; the other side receives.
  const verb = loan.direction === "borrowed" ? "Betalte du" : "Fekk du";

  return (
    <section
      aria-label="Planlagd betaling"
      className="space-y-4 rounded-[28px] bg-tertiary-container p-5 text-on-tertiary-container"
    >
      <div>
        {showLoanName && <p className="text-sm opacity-80">{loan.name}</p>}
        <h2 className="text-lg font-medium">
          {verb} {formatKr(pending.amountOre, { trimZeros: true })} {formatDate(pending.dueDate)}?
        </h2>
        <p className="mt-1 text-sm opacity-80">Etter planen. «Ja» fører innbetalinga på den datoen.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={isPending} onClick={() => run(confirmPlannedPayment)}>
          Ja
        </Button>
        {other}
        <Button variant="text" disabled={isPending} onClick={() => run(snoozePlannedPayment)}>
          Ikkje enno
        </Button>
        <Button variant="text" disabled={isPending} onClick={() => run(skipPlannedPayment)}>
          Hopp over
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
