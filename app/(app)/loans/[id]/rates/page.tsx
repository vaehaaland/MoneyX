import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RatesView } from "@/components/rates-view";
import { TopBar } from "@/components/ui";
import { getLoan } from "@/lib/loans";

export const metadata: Metadata = { title: "Rente" };

export default async function RatesPage({ params }: PageProps<"/loans/[id]/rates">) {
  const { id } = await params;
  const detail = await getLoan(id);
  if (!detail) notFound();

  return (
    <>
      <TopBar title="Rente" subtitle={detail.loan.name} backHref={`/loans/${id}`} />
      <RatesView loanId={id} rates={detail.rates} today={detail.today} />
    </>
  );
}
