import { cn } from "@/lib/utils";

/**
 * The Ednovax logo, from ednovax.com/logo (web/public/logo). The desk is a product of Ednovax,
 * so it carries the real wordmark with a "Support desk" tag of its own.
 */
export function Logo({ inverse, className }: { inverse?: boolean; className?: string }) {
  if (inverse) return <img src="/logo/logo-white.png" alt="Ednovax" className={cn("h-7 w-auto", className)} />;
  // The navy logo on light surfaces; the white one in dark mode.
  return (
    <>
      <img src="/logo/logo.png" alt="Ednovax" className={cn("h-7 w-auto dark:hidden", className)} />
      <img src="/logo/logo-white.png" alt="Ednovax" className={cn("hidden h-7 w-auto dark:block", className)} />
    </>
  );
}

/** Just the Ednovax mark (the star), for small spaces. */
export function Mark({ className }: { className?: string }) {
  return <img src="/logo/fav.png" alt="" aria-hidden className={cn("size-7 object-contain", className)} />;
}

/** The logo with the product tag under it: "ednovax", then "Support desk". */
export function Wordmark({ inverse, className }: { inverse?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-1.5", className)}>
      <Logo inverse={inverse} className="h-6" />
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
          inverse ? "bg-white/15 text-white" : "bg-primary-soft text-primary",
        )}
      >
        Support desk
      </span>
    </div>
  );
}

/** The hand-drawn underline from ednovax.com, under page titles: a nod to the parent brand. */
export function Flourish({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 14" preserveAspectRatio="none" className={cn("h-2.5 w-full text-flourish", className)} aria-hidden>
      <path
        d="M2 9.5C38 4.8 74 3.6 110 5.2c27 1.2 52 2.6 76 1.4 11-.6 21-1.6 32-3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        className="animate-[draw_700ms_cubic-bezier(0.6,0,0.2,1)_both]"
      />
    </svg>
  );
}
