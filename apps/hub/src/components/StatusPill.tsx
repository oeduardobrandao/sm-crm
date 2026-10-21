import type { ReactNode } from 'react';
import { useHubLook } from '../hooks/useHubLook';

export type PillTone = 'accent' | 'danger' | 'neutral';
export type PillSemantic = 'wait' | 'ok' | 'fix' | 'neutral';

// Fallback only. `accent` means "pending" in PostCard and "confirmed" in the
// Agenda, so callers pass `semantic` explicitly.
const TONE_FALLBACK: Record<PillTone, PillSemantic> = {
  accent: 'wait',
  danger: 'fix',
  neutral: 'neutral',
};

export function StatusPill({
  tone,
  semantic,
  children,
}: {
  tone: PillTone;
  semantic?: PillSemantic;
  children: ReactNode;
}) {
  const look = useHubLook();
  if (look === 'pauta') {
    return (
      <span className={`hub-pill hub-pill-st-${semantic ?? TONE_FALLBACK[tone]}`}>{children}</span>
    );
  }
  return <span className={`hub-pill hub-pill-${tone}`}>{children}</span>;
}
