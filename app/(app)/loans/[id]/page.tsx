import { notFound } from "next/navigation";
import { LoanView } from "@/components/loan-view";
import { IconLink, TopBar } from "@/components/ui";
import { getLoan } from "@/lib/loans";

export default async function LoanPage({ params }: PageProps<"/loans/[id]">) {
  const { id } = await params;
  const detail = await getLoan(id);
  if (!detail) notFound();
  const { loan } = detail;

  return (
    <>
      <TopBar
        title={loan.name}
        backHref="/"
        actions={
          <>
            <IconLink href={`/loans/${loan.id}/rates`} icon="percent" label="Rente" />
            <IconLink href={`/loans/${loan.id}/import`} icon="upload" label="Importer" />
            <IconLink href={`/loans/${loan.id}/settings`} icon="tune" label="Innstillingar" />
          </>
        }
      />
      <LoanView detail={detail} />
    </>
  );
}
