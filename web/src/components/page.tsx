import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { pageMeta, TILE } from "@/lib/pages";
import { useRoute } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Flourish } from "./brand";

/** Every page: its coloured icon tile, a title, an optional line under it, actions on the right. */
export function PageHeader({ title, lead, actions, eyebrow }: { title: string; lead?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  const meta = pageMeta(useRoute().path[0] ?? "overview");
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-7 sm:pb-9">
      <div className="flex min-w-0 items-start gap-4">
        {meta && (
          <span className={cn("mt-1 hidden size-12 shrink-0 place-items-center rounded-2xl sm:grid", TILE[meta.tone])} aria-hidden>
            <meta.icon className="size-6" strokeWidth={1.9} />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="label mb-1">{eyebrow}</div>}
          {/* The underline is positioned under the title, so it is exactly as wide as the words. */}
          <h1 className="relative inline-block pb-2.5 text-[26px] sm:text-[34px]">
            {title}
            <Flourish className="absolute inset-x-0 bottom-0" />
          </h1>
          {lead && <p className="mt-2 max-w-[60ch] text-[14.5px] text-muted sm:text-[15px]">{lead}</p>}
        </div>
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto [&>a]:max-sm:flex-1 [&>button]:max-sm:min-w-0 [&>button]:max-sm:flex-1">{actions}</div>}
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1360px] px-4 py-6 sm:px-9 sm:py-9 lg:px-12 lg:py-11", className)}>{children}</div>;
}

/**
 * A white rounded card with a heading row. With `collapsible`, the heading folds the card away;
 * `defaultOpen="desktop"` starts it open on wide screens and folded on phones.
 */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
  collapsible,
  defaultOpen = true,
  summary,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  collapsible?: boolean;
  defaultOpen?: boolean | "desktop";
  /** Shown next to the title while folded, e.g. a count. */
  summary?: ReactNode;
}) {
  const [open, setOpen] = useState(() => (defaultOpen === "desktop" ? window.matchMedia("(min-width: 640px)").matches : defaultOpen));
  const shown = !collapsible || open;
  return (
    <section className={cn("card flex min-w-0 flex-col", className)}>
      {(title || action) && (
        <div className={cn("flex items-center justify-between gap-4 px-5 pt-4 sm:px-6 sm:pt-5", shown ? "pb-3" : "pb-4 sm:pb-5")}>
          {collapsible ? (
            <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 items-center gap-2 text-left">
              <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", !open && "-rotate-90")} />
              <h2 className="truncate font-display text-[16.5px] font-semibold tracking-tight text-ink sm:text-[17px]">{title}</h2>
              {!open && summary && <span className="shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-[12px] font-semibold text-muted">{summary}</span>}
            </button>
          ) : (
            <h2 className="truncate font-display text-[16.5px] font-semibold tracking-tight text-ink sm:text-[17px]">{title}</h2>
          )}
          {shown && action}
        </div>
      )}
      {shown && <div className={cn("min-w-0 flex-1", bodyClassName)}>{children}</div>}
    </section>
  );
}

/** An empty state that says what to do next. */
export function Empty({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-2 px-6 py-10", className)}>
      <div className="font-display text-[18px] font-semibold tracking-tight">{title}</div>
      {children && <p className="max-w-[56ch] text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="rounded-xl border border-red/20 bg-red-soft px-4 py-3 text-[14px] text-red">{message}</div>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 px-6 py-10 text-muted">
      <span className="size-2.5 animate-[pulse-dot_1s_ease-in-out_infinite] rounded-full bg-primary" />
      <span className="text-[14px]">{label}…</span>
    </div>
  );
}

/** Tabs as rounded pills on a soft track. */
export function Tabs<T extends string>({ tabs, active, onChange, className }: { tabs: Array<{ id: T; label: string; count?: number }>; active: T; onChange: (id: T) => void; className?: string }) {
  return (
    <nav className={cn("flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-paper-2 p-1", className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-[14px] font-semibold whitespace-nowrap transition-colors",
            tab.id === active ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink",
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn("tabular rounded-full px-1.5 text-[11.5px]", tab.id === active ? "bg-primary text-primary-ink" : "bg-line text-muted")}>{tab.count}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

/** A segmented filter: rounded pills on a soft track. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<{ id: T; label: string }>; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-paper-2 p-1">
      {options.map((option) => (
        <button
          key={option.id}
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className={cn(
            "h-8 shrink-0 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition-colors",
            option.id === value ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
