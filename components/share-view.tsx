"use client";

import { useState, useTransition } from "react";
import { createInvite, leaveLoan, removeMember, revokeInvite } from "@/app/(app)/sharing-actions";
import { formatDate } from "@/lib/format";
import type { Loan, LoanInviteRow, LoanPerson } from "@/lib/loans";
import { ROLE_LABELS, type InviteRole } from "@/lib/sharing";
import { Icon } from "./icon";
import { Button, Card, ErrorText, IconButton, Segmented } from "./ui";

const ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: "editor", label: "Kan registrere" },
  { value: "viewer", label: "Kan berre sjå" },
];

/** The link the owner has just created. Shown once: only its hash is stored. */
function NewLink({ url, loanName }: { url: string; loanName: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked: the link is selectable in the field below.
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "MoneyX", text: `Bli med på lånet «${loanName}» i MoneyX`, url });
    } catch {
      // Share sheet dismissed.
    }
  };

  return (
    <div className="space-y-3 rounded-3xl bg-primary-container p-4 text-on-primary-container">
      <p className="text-sm">
        Send denne lenka til den andre. Ho verkar éin gong, i 14 dagar, og blir ikkje vist att her.
      </p>
      <input
        readOnly
        value={url}
        aria-label="Invitasjonslenke"
        onFocus={(event) => event.currentTarget.select()}
        className="h-12 w-full rounded-2xl bg-surface-lowest px-4 text-sm text-on-surface outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="filled" onClick={copy}>
          {copied ? "Kopiert" : "Kopier lenke"}
        </Button>
        {canShare && (
          <Button variant="outlined" onClick={share}>
            Del
          </Button>
        )}
      </div>
    </div>
  );
}

export function ShareView({ loan, people, invites }: { loan: Loan; people: LoanPerson[]; invites: LoanInviteRow[] }) {
  const [role, setRole] = useState<InviteRole>("editor");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Runs a server action and shows its error, if any. */
  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.error);
    });

  const invite = () =>
    startTransition(async () => {
      setError(null);
      const result = await createInvite(loan.id, role);
      if (result.ok) setLink(`${window.location.origin}/invite/${result.token}`);
      else setError(result.error);
    });

  return (
    <div className="animate-enter space-y-4 px-4 pb-10">
      <Card className="px-0 py-2">
        <h2 className="px-5 pt-3 pb-1 text-sm font-medium text-on-surface-variant">Har tilgang</h2>
        <ul>
          {people.map((person) => (
            <li key={person.userId} className="flex items-center gap-4 px-5 py-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
                <Icon name="person" className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {person.name}
                  {person.isMe && <span className="text-on-surface-variant"> (deg)</span>}
                </span>
                <span className="block truncate text-sm text-on-surface-variant">
                  {ROLE_LABELS[person.role]}
                  {person.name !== person.email && person.email ? ` · ${person.email}` : ""}
                </span>
              </span>
              {loan.isOwner && person.role !== "owner" && (
                <IconButton
                  icon="close"
                  label={`Fjern ${person.name}`}
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Fjerne tilgangen til ${person.name}? Det dei har registrert blir ståande.`)) {
                      run(() => removeMember(loan.id, person.userId));
                    }
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </Card>

      {loan.isOwner ? (
        <>
          <Card className="space-y-4">
            <div>
              <h2 className="font-medium">Inviter den andre parten</h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Lag ei lenke og send ho sjølv, til dømes på melding. Den som opnar lenka og loggar inn, får
                tilgang til dette lånet og ingenting anna.
              </p>
            </div>
            <Segmented label="Tilgang" value={role} options={ROLE_OPTIONS} onChange={setRole} />
            <p className="text-sm text-on-surface-variant">
              {role === "editor"
                ? "Kan leggje inn og endre transaksjonar, renter og faste betalingar. Kan ikkje slette lånet eller invitere fleire."
                : "Ser saldo og tidslinje, men kan ikkje endre noko."}
            </p>
            <Button onClick={invite} disabled={pending}>
              {pending ? "Lagar lenke…" : "Lag invitasjonslenke"}
            </Button>
            {link && <NewLink url={link} loanName={loan.name} />}
          </Card>

          {invites.length > 0 && (
            <Card className="px-0 py-2">
              <h2 className="px-5 pt-3 pb-1 text-sm font-medium text-on-surface-variant">Lenker som ikkje er brukte</h2>
              <ul>
                {invites.map((item) => (
                  <li key={item.id} className="flex items-center gap-4 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{ROLE_LABELS[item.role]}</span>
                      <span className="block truncate text-sm text-on-surface-variant">
                        {item.expired
                          ? `Gjekk ut ${formatDate(item.expiresAt.slice(0, 10))}`
                          : `Gyldig til ${formatDate(item.expiresAt.slice(0, 10))}`}
                      </span>
                    </span>
                    <Button variant="text" disabled={pending} onClick={() => run(() => revokeInvite(loan.id, item.id))}>
                      Trekk tilbake
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <Card className="space-y-3">
          <h2 className="font-medium">Forlat lånet</h2>
          <p className="text-sm text-on-surface-variant">
            Du mistar tilgangen. Det du har registrert blir ståande, og eigaren kan invitere deg på nytt.
          </p>
          <Button
            variant="outlined"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Forlate lånet?")) run(() => leaveLoan(loan.id));
            }}
          >
            Forlat lånet
          </Button>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
