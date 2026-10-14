import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn's Sheet, reshaped: a tall rounded panel that floats in from the right
 * with an Apple-style spring curve, over a dimmed, blurred page.
 */
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

interface SheetContentProps extends Omit<ComponentProps<typeof Dialog.Content>, "title"> {
  title: ReactNode;
  description?: ReactNode;
}

export function SheetContent({ title, description, className, children, ...props }: SheetContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-[fade-in_300ms_ease-out] data-[state=closed]:animate-[fade-out_200ms_ease-in]" />
      <Dialog.Content
        className={cn(
          "fixed inset-y-3 right-3 z-50 flex w-[min(640px,calc(100vw-1.5rem))] flex-col overflow-hidden",
          "rounded-sheet bg-[#1b1b21] shadow-[0_40px_120px_rgba(0,0,0,0.8)] outline-none",
          "data-[state=open]:animate-[sheet-in_500ms_var(--ease-fluid)] data-[state=closed]:animate-[sheet-out_250ms_ease-in]",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-6 px-9 pt-9 pb-2">
          <div className="min-w-0">
            <Dialog.Title className="text-title font-medium text-balance">{title}</Dialog.Title>
            {description ? <Dialog.Description className="mt-2 text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Details</Dialog.Description>}
          </div>
          <Dialog.Close className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-muted transition-colors hover:bg-surface-3 hover:text-foreground" aria-label="Close">
            <X className="size-5" />
          </Dialog.Close>
        </div>
        <div className="flex-1 overflow-y-auto px-9 pt-4 pb-10">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
