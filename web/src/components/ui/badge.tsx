import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends ComponentProps<"span"> {
  /** Accent colour from the palette; the badge is a soft tint of it. */
  color?: string;
}

/** A soft, tinted pill. Colour carries meaning (see lib/palette.ts). */
export function Badge({ color = "#9A9AA3", className, style, ...props }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-small font-medium", className)}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, ...style }}
      {...props}
    />
  );
}

/** A small coloured dot: the lightest way to show "what kind of thing". */
export function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} />;
}
