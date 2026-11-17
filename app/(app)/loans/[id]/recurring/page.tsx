import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecurringView } from "@/components/recurring-view";
import { TopBar } from "@/components/ui";
import { getLoan } from "@/lib/loans";

export const instant = false;

export const metadata: Metadata = { title: "Faste betalingar" };

export default async function RecurringPage({ params }: PageProps<"/loans/[id]/recurring">) {
  const { id } = await params;
  const detail = await getLoan(id);
  if (!detail) notFound();

  return (
    <>
      <TopBar title="Faste betalingar" subtitle={detail.loan.name} backHref={`/loans/${id}`} />
      <RecurringView loanId={id} rules={detail.recurring} today={detail.today} />
    </>
  );
}
