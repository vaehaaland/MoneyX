import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlansView } from "@/components/plans-view";
import { TopBar } from "@/components/ui";
import { getLoan } from "@/lib/loans";

export const instant = false;

export const metadata: Metadata = { title: "Nedbetalingsplan" };

export default async function LoanPlanPage({ params }: PageProps<"/loans/[id]/plan">) {
  const { id } = await params;
  const detail = await getLoan(id);
  if (!detail) notFound();

  return (
    <>
      <TopBar title="Nedbetalingsplan" subtitle={detail.loan.name} backHref={`/loans/${id}`} />
      <PlansView detail={detail} />
    </>
  );
}
