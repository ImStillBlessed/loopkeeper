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
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-[fade-in_250ms_ease-out]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-sheet bg-[#1b1b21] p-9 shadow-[0_40px_120px_rgba(0,0,0,0.8)] data-[state=open]:animate-[fade-in_250ms_ease-out]">
          <AlertDialog.Title className="text-title font-medium">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-body text-muted">{description}</AlertDialog.Description>
          <div className="mt-8 flex justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <Button
              className="bg-coral text-black hover:bg-[#ff8585]"
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
