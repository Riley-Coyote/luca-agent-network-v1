import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";

/**
 * FOCUS IS NOT DRAWN HERE, AND THAT IS THE POINT.
 *
 * This shipped as `focus-visible:ring-1 ring-ring` — a saturated-blue ring
 * outside the border box. It was also, as it turns out, inert: an unlayered
 * `:root[data-luca-shell] :focus-visible` rule in the global stylesheet
 * outranked every focus utility in the app and painted its own 2px offset
 * outline instead. Both are gone; the shell now draws one in-place hairline on
 * the focused element's own edge, for every focusable thing, once. See THE
 * FOCUS CONTRACT in `globals/conversation-shell.css`.
 *
 * What a button still gets to decide is the COLOUR of that edge, and only when
 * its ground is inverted. The contract's default is the faint ink role, solved
 * against the app's dark surfaces; on a near-white primary pill that lands at
 * 2.0:1, under the 3:1 floor for focus indicators. So the two filled variants
 * name the ink they are written in instead — which inverts correctly on Paper
 * for free, because there the same token is already the dark end of the ramp.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90 [--mn-focus-edge:hsl(var(--primary-foreground)/0.7)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 [--mn-focus-edge:hsl(var(--destructive-foreground)/0.7)]",
        outline: "border border-input/40 bg-background hover:bg-muted/70",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        xs: "h-6 px-2 text-xs",
        lg: "h-10 px-8",
        icon: "h-8 w-8",
        "icon-xs": "h-6 w-6 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
