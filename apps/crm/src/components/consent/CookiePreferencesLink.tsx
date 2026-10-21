import type { CSSProperties, ReactNode } from 'react';
import { openConsentPreferences } from '@/lib/consent';

interface Props {
  children?: ReactNode;
  /** When given, the default link look is NOT applied (the caller styles it). */
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_STYLE: CSSProperties = {
  color: 'var(--primary-color)',
  textDecoration: 'underline',
  background: 'none',
  border: 0,
  padding: 0,
  font: 'inherit',
  cursor: 'pointer',
};

/**
 * Withdrawal entry point. Deliberately no hooks and no i18n: LgpdPage renders this in Node during
 * prerender (scripts/seo/prerender.tsx), where neither is initialised. Copy is pt by default.
 */
export function CookiePreferencesLink({
  children = 'Preferências de cookies',
  className,
  style,
}: Props) {
  return (
    <button
      type="button"
      className={className}
      style={className ? style : { ...DEFAULT_STYLE, ...style }}
      onClick={() => openConsentPreferences()}
    >
      {children}
    </button>
  );
}
