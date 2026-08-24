import type { BlockProps } from '../BlockRenderer';

export function SectionHeaderBlock({ block }: BlockProps) {
  const title = typeof block.config?.title === 'string' ? block.config.title : '';
  const subtitle = typeof block.config?.subtitle === 'string' ? block.config.subtitle : '';
  if (!title) return null;
  return (
    <div style={{ marginTop: '1rem' }}>
      <h2
        style={{
          margin: 0,
          fontSize: '1.15rem',
          fontFamily: 'var(--rb-font-display, inherit)',
          color: 'var(--rb-section-title, inherit)',
          letterSpacing: '-1px',
        }}
      >
        {title}
      </h2>
      {subtitle ? (
        <p style={{ margin: '0.15rem 0 0', opacity: 0.7, fontSize: '0.85rem' }}>{subtitle}</p>
      ) : null}
      <div
        style={{
          width: 48,
          height: 3,
          background: 'var(--rb-accent-line, var(--rb-accent))',
          borderRadius: 2,
          marginTop: '0.4rem',
        }}
      />
    </div>
  );
}
