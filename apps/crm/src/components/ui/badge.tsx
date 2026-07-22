import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge renders the shared `.badge` pill defined in `apps/crm/style.css`, so
 * React call sites and the plain `<span className="badge badge-*">` markup
 * scattered across the app stay visually identical.
 *
 * `variant` picks the colour, `tone` picks soft tint (default) vs solid fill,
 * `size` picks the density. Prefer `size="sm"` over inline font-size overrides.
 */
const badgeVariants = cva('badge', {
  variants: {
    variant: {
      neutral: 'badge-neutral',
      success: 'badge-success',
      warning: 'badge-warning',
      danger: 'badge-danger',
      info: 'badge-info',
      primary: 'badge-primary',
      outline: 'badge-outline',
      /** @deprecated legacy shadcn names — prefer the semantic variants above. */
      default: 'badge-primary',
      secondary: 'badge-neutral',
      destructive: 'badge-danger',
    },
    tone: {
      soft: '',
      solid: 'badge--solid',
    },
    size: {
      sm: 'badge--sm',
      md: '',
      lg: 'badge--lg',
    },
  },
  defaultVariants: {
    variant: 'neutral',
    tone: 'soft',
    size: 'md',
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, tone, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
