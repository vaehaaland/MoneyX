import type { Metadata } from "next";
import { connection } from "next/server";
import { LoanForm } from "@/components/loan-form";
import { TopBar } from "@/components/ui";
import { todayIso } from "@/lib/format";

export const metadata: Metadata = { title: "Nytt lån" };

export default async function NewLoanPage() {
  await connection();
  return (
    <>
      <TopBar title="Nytt lån" backHref="/" />
      <div className="animate-enter px-4 pb-10">
        <LoanForm today={todayIso()} />
      </div>
    </>
  );
}
