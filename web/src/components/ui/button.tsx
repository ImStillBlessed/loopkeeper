import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** shadcn's Button: rounded, sentence case, electric blue for the main action. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-[14px] font-semibold select-none " +
    "transition-[background-color,color,border-color,box-shadow,transform] duration-150 active:scale-[0.98] " +
    "disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-ink shadow-[0_4px_12px_-4px_rgb(31_107_255/0.55)] hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)]",
        navy: "bg-ink text-card hover:bg-ink-2",
        outline: "border border-line bg-card text-ink hover:border-faint hover:bg-paper",
        ghost: "text-muted hover:bg-paper hover:text-ink",
        danger: "bg-red text-white hover:bg-[color-mix(in_srgb,var(--red)_86%,black)]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3.5 text-[13.5px]",
        lg: "h-12 px-6 text-[15px]",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
