import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium select-none " +
    "transition-[transform,background-color,color,opacity] duration-300 ease-fluid active:scale-[0.97] " +
    "disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[1.1em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-lilac text-black hover:bg-[#c4b2ff]",
        secondary: "bg-surface-2 text-foreground hover:bg-surface-3",
        ghost: "text-muted hover:bg-surface-1 hover:text-foreground",
        outline: "border border-hairline text-foreground hover:bg-surface-1",
      },
      size: {
        default: "h-12 px-6 text-body",
        sm: "h-10 px-4 text-small",
        lg: "h-14 px-8 text-lead",
        icon: "size-11",
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
