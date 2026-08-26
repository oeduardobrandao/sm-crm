import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Peças presentacionais dos corpos de página do guia. Sem estado, sem dados. */

export function GuideTip({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        marginTop: 16,
        background: 'rgba(255,191,48,0.14)',
        border: '1px solid rgba(255,191,48,0.55)',
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: '0.8rem',
        lineHeight: 1.6,
      }}
    >
      {children}
    </p>
  );
}

export function GuideFine({ children }: { children: ReactNode }) {
  return (
    <p style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
      {children}
    </p>
  );
}

export function GuideInfoBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        background: 'var(--surface-2, #f8fafc)',
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: '0.8rem',
        lineHeight: 1.7,
      }}
    >
      {children}
    </div>
  );
}

export function GuideOptionGrid({ columns, children }: { columns: 2 | 3; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${columns === 3 ? 150 : 200}px, 1fr))`,
        gap: 10,
        marginTop: 14,
      }}
    >
      {children}
    </div>
  );
}

export function GuideOption({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: '12px 14px' }}>
      <p
        style={{
          margin: 0,
          fontSize: '0.82rem',
          fontWeight: 600,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <Icon className="h-4 w-4" />
        {title}
      </p>
      {children && (
        <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {children}
        </p>
      )}
    </div>
  );
}

export function GuideCheckList({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gap: 9 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.82rem' }}>
          <span
            aria-hidden="true"
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'rgba(62,207,142,0.18)',
              color: '#15803d',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
              fontSize: '0.7rem',
              fontWeight: 700,
            }}
          >
            ✓
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function GuideStatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const tones = {
    neutral: { bg: 'var(--surface-2, #f1f5f9)', fg: 'var(--text-muted)' },
    success: { bg: 'rgba(62,207,142,0.16)', fg: '#15803d' },
    warning: { bg: 'rgba(255,191,48,0.2)', fg: '#a16207' },
  } as const;
  const t = tones[tone];
  return (
    <span
      style={{
        fontSize: '0.7rem',
        padding: '2px 9px',
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
