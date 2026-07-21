export interface ResolvedHubTheme {
  vars: Record<string, string>;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  const int = parseInt(hex.slice(1), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const LIGHT = {
  bg: '#FAFAFA',
  card: '#FFFFFF',
  txt: '#171717',
  tx2: '#525252',
  tx3: '#8A8A8A',
  bd: 'rgba(0,0,0,.08)',
  bd2: 'rgba(0,0,0,.2)',
  soft: '#F4F4F4',
  logoFilter: 'none',
};

const DARK = {
  bg: '#0E0E0E',
  card: '#181818',
  txt: '#F5F5F5',
  tx2: '#B3B3B3',
  tx3: '#8A8A8A',
  bd: 'rgba(255,255,255,.09)',
  bd2: 'rgba(255,255,255,.22)',
  soft: '#242424',
  logoFilter: 'invert(1) brightness(1.6)',
};

export function resolveHubTheme(
  accentColor: string | null | undefined,
  dark: boolean,
): ResolvedHubTheme {
  let acc = accentColor && HEX_RE.test(accentColor) ? accentColor : '#171717';
  const lum = relativeLuminance(acc);
  if (dark && lum < 0.18) acc = '#F5F5F5';
  else if (!dark && lum > 0.85) acc = '#171717';
  const accFg = relativeLuminance(acc) > 0.55 ? '#171717' : '#ffffff';

  const t = dark ? DARK : LIGHT;

  return {
    vars: {
      '--hub-bg': t.bg,
      '--hub-card': t.card,
      '--hub-txt': t.txt,
      '--hub-tx2': t.tx2,
      '--hub-tx3': t.tx3,
      '--hub-bd': t.bd,
      '--hub-bd2': t.bd2,
      '--hub-soft': t.soft,
      '--hub-acc': acc,
      '--hub-acc-fg': accFg,
      '--hub-logo-filter': t.logoFilter,
    },
  };
}
