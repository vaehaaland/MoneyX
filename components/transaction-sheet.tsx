"use client";

import { useState, useTransition } from "react";
import { deleteTransaction, saveTransaction } from "@/app/(app)/actions";
import { formatKr, parseAmountToOre } from "@/lib/format";
import type { TransactionKind } from "@/lib/loan-engine";
import type { LoanTransactionRow } from "@/lib/loans";
import { Sheet } from "./sheet";
import { Button, ErrorText, Field, Segmented } from "./ui";

type Group = "repayment" | "disbursement" | "other";

function Form({
  loanId,
  editing,
  defaultKind,
  today,
  onDone,
}: {
  loanId: string;
  editing: LoanTransactionRow | null;
  defaultKind: TransactionKind;
  today: string;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<TransactionKind>(editing?.kind ?? defaultKind);
  const [amount, setAmount] = useState(
    editing ? (editing.amountOre / 100).toLocaleString("nb-NO", { useGrouping: false }) : "",
  );
  const [date, setDate] = useState(editing?.date ?? today);
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const group: Group = kind === "repayment" || kind === "disbursement" ? kind : "other";
  const amountOre = parseAmountToOre(amount);

  const submit = () => {
    if (amountOre === null || amountOre === 0) return setError("Skriv inn eit beløp.");
    if (amountOre < 0 && kind !== "adjustment") return setError("Beløpet må vere positivt.");
    setError(null);
    startTransition(async () => {
      const result = await saveTransaction(loanId, { id: editing?.id, date, amountOre, kind, note });
      if (result.ok) onDone();
      else setError(result.error);
    });
  };

  const remove = () => {
    if (!editing) return;
    startTransition(async () => {
      const result = await deleteTransaction(loanId, editing.id);
      if (result.ok) onDone();
      else setError(result.error);
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Segmented<Group>
        label="Type"
        value={group}
        onChange={(next) => setKind(next === "other" ? "fee" : next)}
        options={[
          { value: "repayment", label: "Innbetaling" },
          { value: "disbursement", label: "Uttak" },
          { value: "other", label: "Anna" },
        ]}
      />
      {group === "other" && (
        <Segmented<TransactionKind>
          label="Anna type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "fee", label: "Gebyr" },
            { value: "adjustment", label: "Justering" },
          ]}
        />
      )}
      <Field
        label="Beløp"
        suffix="kr"
        inputMode="decimal"
        autoComplete="off"
        autoFocus={!editing}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        hint={
          kind === "adjustment"
            ? "Positivt beløp aukar lånet, negativt reduserer det."
            : amountOre && amountOre > 0
              ? formatKr(amountOre)
              : undefined
        }
      />
      <Field
        label="Dato"
        type="date"
        required
        value={date}
        onChange={(event) => setDate(event.target.value)}
      />
      <Field
        label="Notat (valfritt)"
        maxLength={500}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <ErrorText>{error}</ErrorText>
      <div className="flex items-center gap-2 pt-2">
        {editing &&
          (confirmDelete ? (
            <Button variant="danger" icon="delete" disabled={pending} onClick={remove}>
              Stadfest sletting
            </Button>
          ) : (
            <Button variant="danger" icon="delete" disabled={pending} onClick={() => setConfirmDelete(true)}>
              Slett
            </Button>
          ))}
        <Button type="submit" disabled={pending} className="ml-auto min-w-28">
          {pending ? "Lagrar…" : "Lagre"}
        </Button>
      </div>
    </form>
  );
}

export function TransactionSheet({
  open,
  onClose,
  loanId,
  editing,
  defaultKind,
  today,
}: {
  open: boolean;
  onClose: () => void;
  loanId: string;
  editing: LoanTransactionRow | null;
  defaultKind: TransactionKind;
  today: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Endre transaksjon" : "Ny transaksjon"}>
      <Form
        key={editing?.id ?? "new"}
        loanId={loanId}
        editing={editing}
        defaultKind={defaultKind}
        today={today}
        onDone={onClose}
      />
    </Sheet>
  );
}
