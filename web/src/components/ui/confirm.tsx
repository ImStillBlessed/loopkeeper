import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useState, type ReactNode } from "react";
import { Button } from "./button";

/** shadcn-style confirm dialog for anything that can't be undone. */
export function Confirm({
  title,
  description,
  action,
  onConfirm,
  children,
}: {
  title: string;
  description: ReactNode;
  action: string;
  onConfirm: () => Promise<void> | void;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger asChild>{children}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-[rgb(14_31_85/0.3)] backdrop-blur-[2px] data-[state=open]:animate-[fade-in_200ms_ease-out]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-card p-8 shadow-float data-[state=open]:animate-[rise_200ms_ease-out]">
          <AlertDialog.Title className="font-display text-[22px] font-semibold tracking-tight">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-muted">{description}</AlertDialog.Description>
          <div className="mt-7 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {action}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
