import type { ReactNode } from 'react';
import { CookiePreferencesLink } from '../../components/consent/CookiePreferencesLink';

/**
 * Shared layout of the English legal pages. Same structure and inline styles as the Portuguese
 * PoliticaPage and TermosPage, so both languages look the same. Pure JSX with no hooks: these
 * pages are prerendered with renderToStaticMarkup in Node.
 */

export const LEGAL_LAST_UPDATED_EN = 'November 25, 2026';

export const linkStyle = { color: 'var(--primary-color)', textDecoration: 'underline' } as const;

export interface LegalSectionEn {
  title: string;
  /** Optional anchor id on the section wrapper (for example `cookies`). */
  id?: string;
  content: ReactNode;
}

interface Props {
  title: string;
  subtitle: string;
  intro?: ReactNode;
  sections: LegalSectionEn[];
}

export function LegalPageShellEn({ title, subtitle, intro, sections }: Props) {
  return (
    <div
      lang="en"
      style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1rem' }}
      className="animate-up"
    >
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '2.5rem',
            color: 'var(--text-main)',
            marginBottom: '0.5rem',
          }}
        >
          {title}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>{subtitle}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
          Last updated: {LEGAL_LAST_UPDATED_EN}
        </p>
      </div>

      <div className="card" style={{ lineHeight: 1.7 }}>
        {intro && (
          <div style={{ marginBottom: '2rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            {intro}
          </div>
        )}

        {sections.map(({ title: sectionTitle, id, content }) => (
          <div
            key={sectionTitle}
            id={id}
            style={{ marginBottom: '2rem', scrollMarginTop: id ? '5rem' : undefined }}
          >
            <h2
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: '1.5rem',
                color: 'var(--primary-color)',
                marginBottom: '1rem',
                paddingBottom: '0.5rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              {sectionTitle}
            </h2>
            {content}
          </div>
        ))}
      </div>

      <p
        style={{
          textAlign: 'center',
          marginTop: '3rem',
          color: 'var(--text-muted)',
          fontSize: '0.9rem',
        }}
      >
        Mesaas, operated by EBS IT SOLUTIONS, Salvador, Brazil
      </p>

      <p style={{ textAlign: 'center', marginTop: '1rem' }}>
        <CookiePreferencesLink>Cookie settings</CookiePreferencesLink>
      </p>
    </div>
  );
}
