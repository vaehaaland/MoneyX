import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShareView } from "@/components/share-view";
import { TopBar } from "@/components/ui";
import { getLoan, listOpenInvites } from "@/lib/loans";

export const instant = false;

export const metadata: Metadata = { title: "Deling" };

export default async function LoanSharePage({ params }: PageProps<"/loans/[id]/share">) {
  const { id } = await params;
  const detail = await getLoan(id);
  if (!detail) notFound();
  // Row level security returns invites to the owner only.
  const invites = detail.loan.isOwner ? await listOpenInvites(id) : [];

  return (
    <>
      <TopBar title="Deling" subtitle={detail.loan.name} backHref={`/loans/${id}`} />
      <ShareView loan={detail.loan} people={detail.people} invites={invites} />
    </>
  );
}
