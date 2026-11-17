import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LoanForm } from "@/components/loan-form";
import { TopBar } from "@/components/ui";
import { getLoan } from "@/lib/loans";

export const instant = false;

export const metadata: Metadata = { title: "Innstillingar" };

export default async function LoanSettingsPage({ params }: PageProps<"/loans/[id]/settings">) {
  const { id } = await params;
  const detail = await getLoan(id);
  if (!detail) notFound();

  return (
    <>
      <TopBar title="Innstillingar" subtitle={detail.loan.name} backHref={`/loans/${id}`} />
      <div className="animate-enter px-4 pb-10">
        <LoanForm loan={detail.loan} today={detail.today} />
      </div>
    </>
  );
}
