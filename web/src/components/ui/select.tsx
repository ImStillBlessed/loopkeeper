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

/** shadcn's Select (Radix), with the same height and corners as the inputs next to it. */
export function Select({
  value,
  onValueChange,
  options,
  label,
  size = "default",
  className,
  icon,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  /** Accessible name, since the trigger shows only the value. */
  label: string;
  size?: "default" | "sm";
  className?: string;
  icon?: ReactNode;
  placeholder?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-between gap-2 rounded-control border border-line bg-card text-ink outline-none transition-[border-color,box-shadow]",
          "hover:border-faint data-[state=open]:border-primary data-[state=open]:shadow-[0_0_0_4px_var(--primary-soft)]",
          size === "sm" ? "h-9 px-3 text-[13.5px]" : "h-10 px-3.5",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">
            <SelectPrimitive.Value placeholder={placeholder} />
          </span>
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(380px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-line bg-card shadow-float data-[state=open]:animate-[fade-in_120ms_ease-out]"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer items-center gap-3 rounded-lg py-2 pr-9 pl-3 text-ink outline-none select-none data-[highlighted]:bg-paper"
              >
                <span className="min-w-0">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.hint && <span className="block text-[12.5px] text-muted">{option.hint}</span>}
                </span>
                <SelectPrimitive.ItemIndicator className="absolute right-3">
                  <Check className="size-3.5 text-primary" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
