import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-14 w-full rounded-pill bg-surface-2 px-6 text-lead text-foreground placeholder:text-faint",
        "outline-none transition-colors duration-300 focus:bg-surface-3",
        className,
      )}
      {...props}
    />
  );
}
