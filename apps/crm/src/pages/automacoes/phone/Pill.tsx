import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { PillTone } from './phoneFormat';

/** Small label of the phone automation rows: a keyword (`mono`) or a state badge. */
export function Pill({
  tone = 'neutral',
  mono = false,
  children,
}: {
  tone?: PillTone;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'phone-auto-pill',
        mono ? 'phone-auto-pill--keyword' : `phone-auto-pill--${tone}`,
      )}
    >
      {children}
    </span>
  );
}
