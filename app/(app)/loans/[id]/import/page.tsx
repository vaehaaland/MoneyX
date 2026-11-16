import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ImportWizard } from "@/components/import-wizard";
import { TopBar } from "@/components/ui";
import { getLoan } from "@/lib/loans";

export const metadata: Metadata = { title: "Importer" };

export default async function ImportPage({ params }: PageProps<"/loans/[id]/import">) {
  const { id } = await params;
  const detail = await getLoan(id);
  if (!detail) notFound();

  return (
    <>
      <TopBar title="Importer historikk" subtitle={detail.loan.name} backHref={`/loans/${id}`} />
      <ImportWizard
        loanId={id}
        existing={detail.transactions}
        rates={detail.rates}
        capitalization={detail.loan.capitalization}
        today={detail.today}
      />
    </>
  );
}
