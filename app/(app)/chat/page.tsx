import type { Metadata } from "next";
import { ChatView } from "@/components/chat-view";
import { TopBar } from "@/components/ui";
import { getLoan } from "@/lib/loans";

export const instant = false;

export const metadata: Metadata = { title: "Spør" };

export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const { loan: loanId } = await searchParams;
  // Opened from a loan: questions are about that loan unless the user says otherwise.
  const detail = typeof loanId === "string" ? await getLoan(loanId) : null;
  const loan = detail ? { id: detail.loan.id, name: detail.loan.name } : null;

  return (
    <>
      <TopBar
        title="Spør"
        subtitle={loan ? `Om ${loan.name}` : "Om låna dine"}
        backHref={loan ? `/loans/${loan.id}` : undefined}
      />
      <ChatView loan={loan} />
    </>
  );
}
