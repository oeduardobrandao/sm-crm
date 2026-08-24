import type { BlockProps } from '../BlockRenderer';

export function CoverBlock({ snapshot }: BlockProps) {
  const b = snapshot.branding;
  return (
    <header
      className="rb-cover"
      style={{
        background: 'var(--rb-cover-bg, var(--rb-accent))',
        color: 'var(--rb-cover-fg, var(--rb-accent-fg))',
        borderRadius: 12,
        padding: '2.5rem 2rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {b.logo_url ? (
          <img
            src={b.logo_url}
            alt=""
            style={{ height: 36, borderRadius: 8, background: '#fff', padding: 4 }}
          />
        ) : null}
        <span style={{ fontWeight: 600 }}>{b.workspace_name}</span>
      </div>
      <p
        style={{
          margin: '2rem 0 0',
          opacity: 0.85,
          fontSize: '0.8rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        Relatório mensal · Instagram
      </p>
      <h1
        style={{
          margin: '0.25rem 0 0',
          fontSize: '2rem',
          fontFamily: 'var(--rb-font-display, inherit)',
          letterSpacing: '-1px',
        }}
      >
        {snapshot.period.label}
      </h1>
      <p style={{ margin: '0.25rem 0 0', opacity: 0.9 }}>
        @{snapshot.account.handle}
        {snapshot.account.specialty ? ` · ${snapshot.account.specialty}` : ''}
      </p>
      {b.splash_url ? (
        <img
          src={b.splash_url}
          alt=""
          style={{
            marginTop: '1.5rem',
            width: '100%',
            aspectRatio: '21 / 9',
            objectFit: 'cover',
            borderRadius: 8,
          }}
        />
      ) : null}
    </header>
  );
}
