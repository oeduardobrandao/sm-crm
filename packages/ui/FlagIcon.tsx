import { useId } from 'react';
import type { Language } from '@mesaas/i18n';

/**
 * Flag glyphs for the language toggle, drawn rather than typed as emoji: the
 * regional-indicator pairs render as bare letter pairs ("BR", "US") on Windows,
 * which has no emoji flag font, and pick up the surrounding text colour
 * everywhere else. These stay full-colour on every platform.
 */
export function FlagIcon({ lang, size = 18 }: { lang: Language; size?: number }) {
  // The sidebar and the mobile drawer can both be mounted at once, so the
  // clipPath id has to be unique per instance or the duplicate wins silently.
  const clip = useId();
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    role: 'presentation' as const,
    'aria-hidden': true,
  };

  if (lang === 'en') {
    return (
      <svg {...common}>
        <defs>
          <clipPath id={clip}>
            <circle cx="12" cy="12" r="11" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <rect width="24" height="24" fill="#F5F5F5" />
          {[0, 2, 4, 6, 8, 10].map((i) => (
            <rect key={i} y={1 + i * 3.7} width="24" height="1.85" fill="#D02F44" />
          ))}
          <rect width="11" height="12.9" fill="#2B3A6B" />
          {[
            [2, 2.6],
            [5.5, 2.6],
            [9, 2.6],
            [3.75, 5.2],
            [7.25, 5.2],
            [2, 7.8],
            [5.5, 7.8],
            [9, 7.8],
            [3.75, 10.4],
            [7.25, 10.4],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.75" fill="#F5F5F5" />
          ))}
        </g>
        <circle cx="12" cy="12" r="11" fill="none" stroke="rgba(0,0,0,.12)" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <defs>
        <clipPath id={clip}>
          <circle cx="12" cy="12" r="11" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="24" height="24" fill="#009B3A" />
        <path d="M12 3.2 21.4 12 12 20.8 2.6 12Z" fill="#FEDF00" />
        <circle cx="12" cy="12" r="4.1" fill="#002776" />
        <path
          d="M8.1 10.6a10.5 10.5 0 0 1 7.7 2.2"
          fill="none"
          stroke="#F5F5F5"
          strokeWidth="1.1"
        />
      </g>
      <circle cx="12" cy="12" r="11" fill="none" stroke="rgba(0,0,0,.12)" />
    </svg>
  );
}
