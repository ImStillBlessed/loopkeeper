import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const EASE = [0.32, 0.72, 0, 1] as const;

interface PageProps {
  children: ReactNode;
  /** Glanceable extras for wide screens. Hidden below 1280px, where the main column is enough. */
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

/**
 * Every page enters the same way: a short rise and fade on a fluid curve.
 * The main column stays readable (≈ 70 characters); side rails use the space on wide screens.
 */
export function Page({ children, left, right, className }: PageProps) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 24, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
      transition={{ duration: 0.55, ease: EASE }}
      className="absolute inset-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
    >
      <div className="mx-auto grid max-w-[1480px] grid-cols-1 gap-16 px-8 pt-32 pb-40 xl:grid-cols-[280px_minmax(0,1fr)_280px] xl:px-12">
        <aside className="hidden xl:block">{left && <Rail delay={0.25}>{left}</Rail>}</aside>
        <div className={cn("mx-auto w-full max-w-3xl", className)}>{children}</div>
        <aside className="hidden xl:block">{right && <Rail delay={0.35}>{right}</Rail>}</aside>
      </div>
    </motion.main>
  );
}

function Rail({ children, delay }: { children: ReactNode; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.6, ease: EASE }}
      className="sticky top-32 flex flex-col gap-10"
    >
      {children}
    </motion.div>
  );
}

/** A titled block inside a side rail. */
export function RailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-body font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
}

/** A label with a soft horizontal bar: the lightest possible chart. */
export function RailBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3 text-small">
        <span className="truncate">{label}</span>
        <span className="font-medium tabular-nums" style={{ color }}>{value}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-1">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${max ? (value / max) * 100 : 0}%` }}
          transition={{ duration: 0.9, ease: EASE }}
        />
      </div>
    </div>
  );
}

/** Large, light page headline. */
export function Headline({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={cn("text-headline font-light tracking-tight text-balance sm:text-display", className)}>{children}</h1>;
}
