import Link from "next/link";
import { Icon } from "@/components/icon";
import { buttonClass, Card, TopBar } from "@/components/ui";
import { formatKr, formatRate } from "@/lib/format";
import { balanceLabel } from "@/lib/labels";
import { listLoans } from "@/lib/loans";

export default async function LoansPage() {
  const loans = await listLoans();

  return (
    <>
      <TopBar
        title="Lån"
        actions={
          loans.length > 0 && (
            <Link href="/loans/new" className={buttonClass("tonal", "mr-3 h-10 px-4")}>
              <Icon name="add" className="size-5 -ml-1" />
              Nytt lån
            </Link>
          )
        }
      />
      <div className="animate-enter space-y-3 px-4 pb-10">
        {loans.length === 0 && (
          <Card className="space-y-4 py-12 text-center">
            <h2 className="text-2xl">Få lånet ut av reknearket</h2>
            <p className="mx-auto max-w-sm text-on-surface-variant">
              Opprett lånet, legg inn eller importer det som har skjedd, så held appen saldoen for deg.
            </p>
            <Link href="/loans/new" className={buttonClass("filled")}>
              <Icon name="add" className="size-5 -ml-1" />
              Opprett første lån
            </Link>
          </Card>
        )}
        {loans.map(({ loan, ledger, transactions }) => (
          <Link key={loan.id} href={`/loans/${loan.id}`} className="state-layer block rounded-[28px] bg-surface-low p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-medium">{loan.name}</h2>
                <p className="truncate text-sm text-on-surface-variant">
                  {balanceLabel(loan.direction, loan.counterpartyName, ledger.balanceOre)}
                </p>
              </div>
              <Icon name="chevron" className="mt-1 size-6 text-on-surface-variant" />
            </div>
            <p className="mt-4 text-3xl font-medium tracking-tight tabular-nums">
              {formatKr(Math.abs(ledger.balanceOre), { trimZeros: true })}
            </p>
            <p className="mt-1 text-sm text-on-surface-variant">
              {ledger.currentRateBp > 0 ? `${formatRate(ledger.currentRateBp)} rente` : "Rentefritt"} ·{" "}
              {transactions.length} {transactions.length === 1 ? "transaksjon" : "transaksjonar"}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
