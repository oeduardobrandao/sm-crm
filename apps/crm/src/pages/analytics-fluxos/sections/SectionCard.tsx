import type { ReactNode } from 'react';

/** Card chrome shared by the three sections: title, caption and body. */
export function SectionCard({
  title,
  caption,
  action,
  footer,
  children,
}: {
  title: string;
  caption: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card animate-up" style={{ padding: '1rem 1.15rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        <div>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>{title}</h2>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
            {caption}
          </p>
        </div>
        {action}
      </div>
      <div style={{ marginTop: '0.9rem' }}>{children}</div>
      {footer}
    </section>
  );
}

/** Centered muted line for a section with nothing to plot. */
export function SectionEmpty({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        margin: 0,
        padding: '2rem 0',
        textAlign: 'center',
      }}
    >
      {children}
    </p>
  );
}
