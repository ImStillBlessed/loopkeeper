import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/** iOS-style segmented control; the selection glides between options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div role="tablist" className="inline-flex gap-1 rounded-pill bg-surface-1 p-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative h-11 rounded-pill px-6 text-small font-medium transition-colors duration-300",
              active ? "text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segment-${id}`}
                className="absolute inset-0 rounded-pill bg-surface-3"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
