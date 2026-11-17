import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AcceptInvite } from "@/components/accept-invite";
import { buttonClass, Card, TopBar } from "@/components/ui";
import { isInviteToken, parseInviteResult, ROLE_LABELS, type InvitePreview } from "@/lib/sharing";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

// The token in the address is a secret: keep it out of search engines and referrers.
export const metadata: Metadata = { title: "Invitasjon", robots: { index: false }, referrer: "no-referrer" };

const PROBLEMS: Partial<Record<InvitePreview["status"], { title: string; text: string }>> = {
  invalid: { title: "Lenka er ikkje gyldig", text: "Sjekk at du fekk med heile lenka, eller be om ei ny." },
  used: { title: "Lenka er alt brukt", text: "Kvar lenke verkar éin gong. Be den som inviterte deg om ei ny." },
  expired: { title: "Lenka er utgått", text: "Be den som inviterte deg om ei ny lenke." },
};

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  let preview: InvitePreview = parseInviteResult(null);
  if (isInviteToken(token)) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("loan_invite_preview", { p_token: token });
    if (error) throw new Error(error.message);
    preview = parseInviteResult(data);
  }

  // Already on the loan: nothing to accept.
  if (preview.loanId && (preview.status === "own_loan" || preview.status === "already_member")) {
    redirect(`/loans/${preview.loanId}`);
  }
  const problem = PROBLEMS[preview.status];

  return (
    <>
      <TopBar title="Invitasjon" />
      <div className="animate-enter space-y-4 px-4 pb-10">
        {preview.status === "open" && preview.role ? (
          <Card className="space-y-4">
            <div>
              <p className="text-sm text-on-surface-variant">{preview.invitedBy ?? "Nokon"} har invitert deg til lånet</p>
              <h2 className="mt-1 text-2xl [overflow-wrap:anywhere]">{preview.loanName}</h2>
            </div>
            <p className="text-on-surface-variant">
              {preview.role === "editor"
                ? "Du får sjå saldo og tidslinje, og kan sjølv leggje inn innbetalingar og uttak."
                : "Du får sjå saldo og tidslinje, men kan ikkje endre noko."}{" "}
              <span className="text-on-surface">{ROLE_LABELS[preview.role]}.</span>
            </p>
            <AcceptInvite token={token} />
          </Card>
        ) : (
          <Card className="space-y-4">
            <h2 className="text-xl">{problem?.title ?? "Lenka er ikkje gyldig"}</h2>
            <p className="text-on-surface-variant">{problem?.text}</p>
            <Link href="/" className={buttonClass("tonal")}>
              Til låna mine
            </Link>
          </Card>
        )}
      </div>
    </>
  );
}
