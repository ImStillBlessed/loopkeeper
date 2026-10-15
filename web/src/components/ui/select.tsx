import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional second line, e.g. a role or a description. */
  hint?: string;
}

/**
 * shadcn's Select (Radix), styled like our inputs: a pill trigger with the same height as the field
 * next to it, and a rounded, blurred menu that is readable on the dark theme.
 */
export function Select({
  value,
  onValueChange,
  options,
  label,
  size = "default",
  className,
  icon,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  /** Accessible name, since the trigger shows only the value. */
  label: string;
  size?: "default" | "sm";
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-between gap-2 rounded-pill bg-surface-2 text-foreground outline-none transition-colors",
          "hover:bg-surface-3 data-[state=open]:bg-surface-3",
          size === "sm" ? "h-11 px-4 text-small" : "h-12 px-5 text-body",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">
            <SelectPrimitive.Value />
          </span>
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={8}
          className="z-50 max-h-[min(380px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-card bg-[#1f1f25]/95 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl data-[state=open]:animate-[fade-in_180ms_ease-out]"
        >
          <SelectPrimitive.Viewport className="p-2">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer items-center gap-3 rounded-chip py-2.5 pr-10 pl-4 text-body text-foreground outline-none select-none data-[highlighted]:bg-surface-2"
              >
                <span className="min-w-0">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.hint && <span className="block text-small text-faint">{option.hint}</span>}
                </span>
                <SelectPrimitive.ItemIndicator className="absolute right-4">
                  <Check className="size-4 text-mint" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
