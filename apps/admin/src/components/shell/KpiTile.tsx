import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

const TONE = {
  default: { label: 'text-muted-foreground', value: '', border: '' },
  warning: { label: 'text-warning', value: 'text-warning', border: 'border-warning/40' },
  danger: { label: 'text-destructive', value: 'text-destructive', border: 'border-destructive/40' },
  success: { label: 'text-muted-foreground', value: 'text-success', border: '' },
} as const;

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: keyof typeof TONE;
  to?: string;
  /** Smaller value type for long values (money with cents): 22px on desktop, 18px on phone. */
  compact?: boolean;
}

export function KpiTile({ label, value, sub, tone = 'default', to, compact }: KpiTileProps) {
  const t = TONE[tone];
  const body = (
    <>
      <span className={cn('block text-xs font-semibold uppercase tracking-[0.04em]', t.label)}>
        {label}
      </span>
      {/* Never wraps or widens the tile: 22px on phone (admin-kit.css), ellipsis as last resort. */}
      <span
        data-kpi-value
        title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
        className={cn(
          'admin-kpi-value mt-1.5 block min-w-0 truncate font-bold leading-tight tabular-nums',
          compact ? 'admin-kpi-value--compact text-[22px]' : 'text-[28px]',
          t.value,
        )}
      >
        {value}
      </span>
      {sub ? <span className="block text-[13px] text-muted-foreground">{sub}</span> : null}
    </>
  );
  const cls = cn(
    'admin-glass admin-kpi-tile block min-w-0 rounded-[18px] border border-border bg-card px-[18px] py-4 text-card-foreground',
    t.border,
  );
  return to ? (
    <Link to={to} className={cn(cls, 'no-underline hover:bg-card/80')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function KpiGrid({ children, min = 210 }: { children: ReactNode; min?: number }) {
  return (
    <div className="admin-kpi-grid mb-5" style={{ ['--admin-kpi-min' as string]: `${min}px` }}>
      {children}
    </div>
  );
}
