import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        /**
         * Not an alias of `default`: the comment copied from the CRM said so because the CRM's
         * --primary is ink (black/white). The Admin's --primary is gold, so `ink` is a distinct,
         * higher-contrast CTA -- foreground on background rather than gold.
         */
        ink: 'bg-foreground text-background shadow hover:bg-foreground/85',
        destructive: 'bg-destructive/15 text-destructive hover:bg-destructive/25',
        outline: 'border border-border bg-transparent hover:bg-foreground/[0.06]',
        secondary: 'bg-foreground/[0.12] text-foreground hover:bg-foreground/[0.18]',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[34px] px-3.5',
        sm: 'h-7 px-3 text-xs',
        lg: 'h-10 px-6',
        icon: 'h-[34px] w-[34px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
