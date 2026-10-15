import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A settings block: a title, one plain sentence about it, and its controls. */
export function Block({ title, description, children, action }: { title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-card bg-surface-1 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="text-title font-medium">{title}</h2>
          {description && <p className="mt-2 text-body text-muted">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}

/** One row in a list inside a block. */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-4 border-t border-hairline py-5 first:border-t-0 first:pt-0", className)}>{children}</div>;
}

/** A compact text field for forms inside blocks. */
export function Field({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-12 min-w-0 rounded-pill bg-surface-2 px-5 text-body text-foreground placeholder:text-faint outline-none transition-colors focus:bg-surface-3",
        className,
      )}
      {...props}
    />
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  const colors = { info: "bg-sky/10 text-sky", warn: "bg-sunflower/12 text-sunflower", error: "bg-coral/12 text-coral" };
  return <div className={cn("rounded-chip px-5 py-4 text-small", colors[tone])}>{children}</div>;
}
