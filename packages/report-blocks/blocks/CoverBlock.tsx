import { useState } from 'react';
import type { BlockProps } from '../BlockRenderer';
import { pickAccentFg } from '../theme';

const KICKER_DEFAULT = 'Relatório mensal · Instagram';
const LOGO_SIZE_DEFAULT = 36;
const COVER_INK_FALLBACK = '#171717';

export function CoverAvatar({
  name,
  photoUrl,
  size,
}: {
  name: string;
  photoUrl: string | null;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const box = { width: size, height: size };

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        onError={() => setFailed(true)}
        style={{
          ...box,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '1.5px solid currentColor',
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        ...box,
        borderRadius: '50%',
        border: '1.5px solid currentColor',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

export interface CoverConfig {
  kicker?: string;
  title?: string;
  subtitle?: string;
  color?: string;
  logoSize?: number;
}

export function CoverBlock({ block, snapshot }: BlockProps) {
  const b = snapshot.branding;
  const config = (block.config ?? {}) as CoverConfig;
  const kicker = typeof config.kicker === 'string' ? config.kicker : KICKER_DEFAULT;
  const title = typeof config.title === 'string' ? config.title : snapshot.period.label;
  const subtitle =
    typeof config.subtitle === 'string'
      ? config.subtitle
      : `@${snapshot.account.handle}${snapshot.account.specialty ? ` · ${snapshot.account.specialty}` : ''}`;
  const logoSize = config.logoSize ?? LOGO_SIZE_DEFAULT;
  const clientName = snapshot.account.client_name ?? snapshot.account.handle;

  const colorStyle = config.color
    ? { background: config.color, color: pickAccentFg(config.color, COVER_INK_FALLBACK) }
    : {
        background: 'var(--rb-cover-bg, var(--rb-accent))',
        color: 'var(--rb-cover-fg, var(--rb-accent-fg))',
      };

  return (
    <header
      className="rb-cover"
      style={{
        ...colorStyle,
        borderRadius: 12,
        padding: '2.5rem 2rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {b.logo_url ? (
          <img
            src={b.logo_url}
            alt=""
            style={{ height: logoSize, borderRadius: 8, background: '#fff', padding: 4 }}
          />
        ) : null}
        <CoverAvatar
          name={clientName}
          photoUrl={snapshot.account.profile_picture_url ?? null}
          size={logoSize}
        />
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
        {kicker}
      </p>
      <h1
        style={{
          margin: '0.25rem 0 0',
          fontSize: '2rem',
          fontFamily: 'var(--rb-font-display, inherit)',
          letterSpacing: '-1px',
        }}
      >
        {title}
      </h1>
      <p style={{ margin: '0.25rem 0 0', opacity: 0.9 }}>{subtitle}</p>
      {b.splash_url ? (
        <img
          src={b.splash_url}
          alt=""
          className="rb-cover-splash"
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
