"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "./ui";

/** Modal sheet built on <dialog>: bottom sheet on phones, dialog on wide screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="mx-auto mt-3 h-1 w-8 rounded-full bg-outline-variant md:hidden" />
        <div className="flex items-center justify-between pt-2 pr-2 pl-6">
          <h2 className="text-xl">{title}</h2>
          <IconButton icon="close" label="Lukk" onClick={onClose} />
        </div>
        <div className="overflow-y-auto px-6 pt-2 pb-6">{open && children}</div>
      </div>
    </dialog>
  );
}
