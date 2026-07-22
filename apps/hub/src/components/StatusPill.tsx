import type { ReactNode } from 'react';

export type PillTone = 'accent' | 'danger' | 'neutral';

export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`hub-pill hub-pill-${tone}`}>{children}</span>;
}
