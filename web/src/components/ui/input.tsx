import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const FIELD = "w-full rounded-control border border-line bg-card text-ink placeholder:text-faint outline-none transition-[border-color,box-shadow] focus:border-primary focus:shadow-[0_0_0_4px_var(--primary-soft)]";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(FIELD, "h-10 px-3.5", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(FIELD, "min-h-24 resize-y px-3.5 py-3 leading-relaxed", className)} {...props} />;
}

/** A form field: label above, optional hint below. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[13px] text-muted">{hint}</span>}
    </label>
  );
}
