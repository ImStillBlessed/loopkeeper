import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** shadcn's Sheet: a drawer that floats in from the right, with rounded corners, over a dimmed page. */
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

interface SheetContentProps extends Omit<ComponentProps<typeof Dialog.Content>, "title"> {
  title: ReactNode;
  /** Small mono line above the title (e.g. the client and ticket id). */
  eyebrow?: ReactNode;
  description?: ReactNode;
  width?: "md" | "lg";
}

export function SheetContent({ title, eyebrow, description, width = "lg", className, children, ...props }: SheetContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(14_31_85/0.28)] backdrop-blur-[2px] data-[state=open]:animate-[fade-in_200ms_ease-out] data-[state=closed]:animate-[fade-out_150ms_ease-in]" />
      <Dialog.Content
        className={cn(
          "fixed inset-y-2 right-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-float outline-none",
          width === "lg" ? "w-[min(760px,calc(100vw-1rem))]" : "w-[min(520px,calc(100vw-1rem))]",
          "data-[state=open]:animate-[sheet-in_280ms_cubic-bezier(0.2,0.8,0.2,1)] data-[state=closed]:animate-[sheet-out_160ms_ease-in]",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft bg-card px-5 pt-5 pb-4 sm:gap-6 sm:px-8 sm:pt-7 sm:pb-6">
          <div className="min-w-0">
            {eyebrow && <div className="label mb-2">{eyebrow}</div>}
            <Dialog.Title className="font-display text-[21px] font-semibold tracking-tight text-balance sm:text-[26px]">{title}</Dialog.Title>
            {description ? <Dialog.Description className="mt-1.5 text-muted">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Details</Dialog.Description>}
          </div>
          <Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-full bg-paper text-muted transition-colors hover:bg-paper-2 hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </Dialog.Close>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
