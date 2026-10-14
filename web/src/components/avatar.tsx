import { initials } from "@/lib/format";
import { COLORS } from "@/lib/palette";
import { cn } from "@/lib/utils";

/** People are always sky. Initials only: no photos of real people anywhere. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn("grid size-10 shrink-0 place-items-center rounded-full text-small font-medium", className)}
      style={{ color: COLORS.sky, backgroundColor: `color-mix(in srgb, ${COLORS.sky} 16%, transparent)` }}
    >
      {initials(name)}
    </span>
  );
}
