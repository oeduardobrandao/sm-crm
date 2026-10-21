import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Same API as the CRM Badge (variant / tone / size), but built on the admin's Tailwind
 * tokens. The CRM version renders the `.badge*` classes from apps/crm/style.css, which
 * the admin does not load.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] border border-transparent font-bold uppercase leading-none tracking-[0.02em]',
  {
    variants: {
      variant: {
        neutral: 'bg-muted-foreground/10 text-muted-foreground',
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        danger: 'bg-destructive/10 text-destructive',
        // Text on the soft tints reads the text tokens (globals.css): 5.4-6.5:1 in light.
        info: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
        primary: 'bg-primary/20 text-foreground',
        outline: 'border-border bg-transparent text-foreground',
      },
      tone: { soft: '', solid: '' },
      size: {
        sm: 'h-[18px] px-1.5 text-[0.6rem]',
        md: 'h-[18px] px-[7px] text-[11px]',
        lg: 'h-6 px-2.5 text-xs',
      },
    },
    compoundVariants: [
      { variant: 'neutral', tone: 'solid', class: 'bg-muted-foreground text-background' },
      { variant: 'success', tone: 'solid', class: 'bg-success text-background' },
      { variant: 'warning', tone: 'solid', class: 'bg-warning text-background' },
      { variant: 'danger', tone: 'solid', class: 'bg-destructive text-destructive-foreground' },
      { variant: 'info', tone: 'solid', class: 'bg-sky-500 text-white' },
      { variant: 'primary', tone: 'solid', class: 'bg-primary text-primary-foreground' },
    ],
    defaultVariants: { variant: 'neutral', tone: 'soft', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, tone, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
