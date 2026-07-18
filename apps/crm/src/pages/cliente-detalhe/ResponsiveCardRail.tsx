import { Children, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ResponsiveCardRailProps {
  children: ReactNode;
  className?: string;
  itemClassName?: string;
}

export function ResponsiveCardRail({
  children,
  className,
  itemClassName,
}: ResponsiveCardRailProps) {
  const items = Children.toArray(children);

  return (
    <div
      className={cn(
        'cliente-card-rail',
        items.length > 1 && 'cliente-card-rail--multiple',
        className,
      )}
      data-testid="responsive-card-rail"
    >
      {items.map((child, index) => (
        <div
          key={index}
          className={cn('cliente-card-rail__item', itemClassName)}
          data-testid="responsive-card-rail-item"
        >
          {child}
        </div>
      ))}
    </div>
  );
}
