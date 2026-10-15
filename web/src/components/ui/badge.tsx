import type { ComponentProps } from "react";
import type { Tone } from "@/lib/palette";
import { cn } from "@/lib/utils";

const TONES: Record<Tone, string> = {
  red: "bg-red-soft text-red",
  amber: "bg-amber-soft text-amber",
  green: "bg-green-soft text-green",
  blue: "bg-primary-soft text-primary",
  violet: "bg-violet-soft text-violet",
  sky: "bg-sky-soft text-sky",
  neutral: "bg-paper-2 text-muted",
  navy: "bg-violet text-white",
};

const DOTS: Record<Tone, string> = {
  red: "bg-red",
  amber: "bg-amber",
  green: "bg-green",
  blue: "bg-primary",
  violet: "bg-violet",
  sky: "bg-sky",
  neutral: "bg-faint",
  navy: "bg-ink",
};

/** A small rounded pill. Its tone carries meaning (see lib/palette.ts). */
export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold whitespace-nowrap", TONES[tone], className)} {...props} />;
}

/** A round dot, for the lightest "what kind of thing" marker. */
export function Dot({ tone = "neutral", className, pulse }: { tone?: Tone; className?: string; pulse?: boolean }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOTS[tone], pulse && "animate-[pulse-dot_1.6s_ease-in-out_infinite]", className)} />;
}
