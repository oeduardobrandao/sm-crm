import { describe, expect, it } from 'vitest';
import {
  resolveHubTheme,
  relativeLuminance,
  buildGoogleFontsHref,
  DEFAULT_HUB_THEME,
  HUB_DISPLAY_FONTS,
  HUB_BODY_FONTS,
  type HubThemeConfig,
} from './theme';

describe('relativeLuminance', () => {
  it('computes near-0 for near-black and near-1 for near-white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 2);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 2);
  });
});

describe('resolveHubTheme', () => {
  it('light mode: uses the accent as-is when safe, and derives a dark foreground', () => {
    const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: '#315c4c', customized: true }, false);
    expect(t.vars['--hub-acc']).toBe('#315c4c');
    expect(t.vars['--hub-acc-fg']).toBe('#ffffff');
    expect(t.vars['--hub-bg']).toBe('#FAFAFA');
    expect(t.vars['--hub-card']).toBe('#FFFFFF');
  });

  it('light mode: falls back to graphite when the accent is too close to white', () => {
    const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: '#fefefe' }, false);
    expect(t.vars['--hub-acc']).toBe('#171717');
    expect(t.vars['--hub-acc-fg']).toBe('#ffffff');
  });

  it('dark mode: falls back to near-white when the accent is too close to black', () => {
    const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: '#0a0a0a' }, true);
    expect(t.vars['--hub-acc']).toBe('#F5F5F5');
    expect(t.vars['--hub-acc-fg']).toBe('#171717');
    expect(t.vars['--hub-bg']).toBe('#0E0E0E');
  });

  it('picks a dark foreground for a light accent, and a light foreground for a dark accent', () => {
    expect(
      resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: '#eab308' }, false).vars['--hub-acc-fg'],
    ).toBe('#171717');
    expect(
      resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: '#171717' }, false).vars['--hub-acc-fg'],
    ).toBe('#ffffff');
  });

  it('defaults to graphite when accentColor is missing or malformed', () => {
    expect(resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: null }, false).vars['--hub-acc']).toBe(
      '#171717',
    );
    expect(
      resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: 'not-a-color' }, false).vars['--hub-acc'],
    ).toBe('#171717');
    expect(resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: '#fff' }, false).vars['--hub-acc']).toBe(
      '#171717',
    );
  });

  it('does not emit --hub-logo-filter (removed, unused)', () => {
    const t = resolveHubTheme(DEFAULT_HUB_THEME, false);
    expect(t.vars['--hub-logo-filter']).toBeUndefined();
    expect('--hub-logo-filter' in t.vars).toBe(false);
  });

  describe('neutral lock (customized=false reproduces prior neutral output exactly)', () => {
    it('light', () => {
      const t = resolveHubTheme(DEFAULT_HUB_THEME, false);
      expect(t.vars['--hub-bg']).toBe('#FAFAFA');
      expect(t.vars['--hub-card']).toBe('#FFFFFF');
      expect(t.vars['--hub-txt']).toBe('#171717');
      expect(t.vars['--hub-tx2']).toBe('#525252');
      expect(t.vars['--hub-tx3']).toBe('#8A8A8A');
      expect(t.vars['--hub-bd']).toBe('rgba(0,0,0,.08)');
      expect(t.vars['--hub-bd2']).toBe('rgba(0,0,0,.2)');
      expect(t.vars['--hub-soft']).toBe('#F4F4F4');
      expect(t.vars['--hub-primary']).toBe('var(--hub-txt)');
      expect(t.vars['--hub-primary-fg']).toBe('var(--hub-card)');
      expect(t.vars['--hub-ring']).toBe('color-mix(in srgb, var(--hub-txt) 15%, transparent)');
      expect(t.vars['--hub-r-card']).toBe('12px');
      expect(t.vars['--hub-r-ctl']).toBe('8px');
      expect(t.vars['--hub-card-bg']).toBe('var(--hub-card)');
      expect(t.vars['--hub-card-bd']).toBe('var(--hub-bd)');
    });

    it('dark', () => {
      const t = resolveHubTheme(DEFAULT_HUB_THEME, true);
      expect(t.vars['--hub-bg']).toBe('#0E0E0E');
      expect(t.vars['--hub-card']).toBe('#181818');
      expect(t.vars['--hub-txt']).toBe('#F5F5F5');
      expect(t.vars['--hub-tx2']).toBe('#B3B3B3');
      expect(t.vars['--hub-tx3']).toBe('#8A8A8A');
      expect(t.vars['--hub-bd']).toBe('rgba(255,255,255,.09)');
      expect(t.vars['--hub-bd2']).toBe('rgba(255,255,255,.22)');
      expect(t.vars['--hub-soft']).toBe('#242424');
    });
  });

  describe('customized propagation', () => {
    it('customized=true + valid accent drives --hub-primary/--hub-primary-fg/--hub-ring', () => {
      const t = resolveHubTheme(
        { ...DEFAULT_HUB_THEME, customized: true, accent: '#315c4c' },
        false,
      );
      expect(t.vars['--hub-primary']).toBe('#315c4c');
      expect(t.vars['--hub-primary-fg']).toBe('#ffffff');
      expect(t.vars['--hub-ring']).toBe('color-mix(in srgb, #315c4c 22%, transparent)');
    });

    it('customized=true with a light accent picks a dark primary-fg', () => {
      const t = resolveHubTheme(
        { ...DEFAULT_HUB_THEME, customized: true, accent: '#eab308' },
        false,
      );
      expect(t.vars['--hub-primary']).toBe('#eab308');
      expect(t.vars['--hub-primary-fg']).toBe('#171717');
      expect(t.vars['--hub-ring']).toBe('color-mix(in srgb, #eab308 22%, transparent)');
    });

    it('customized=true still clamps an accent that is too close to bg (light)', () => {
      const t = resolveHubTheme(
        { ...DEFAULT_HUB_THEME, customized: true, accent: '#fefefe' },
        false,
      );
      expect(t.vars['--hub-primary']).toBe('#171717');
      expect(t.vars['--hub-ring']).toBe('color-mix(in srgb, #171717 22%, transparent)');
    });
  });

  describe('radius emission', () => {
    it('square', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, radius: 'square' }, false);
      expect(t.vars['--hub-r-card']).toBe('0px');
      expect(t.vars['--hub-r-ctl']).toBe('0px');
    });
    it('soft', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, radius: 'soft' }, false);
      expect(t.vars['--hub-r-card']).toBe('12px');
      expect(t.vars['--hub-r-ctl']).toBe('8px');
    });
    it('pill', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, radius: 'pill' }, false);
      expect(t.vars['--hub-r-card']).toBe('18px');
      expect(t.vars['--hub-r-ctl']).toBe('999px');
    });
  });

  describe('card style emission', () => {
    it('filled', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, cardStyle: 'filled' }, false);
      expect(t.vars['--hub-card-bg']).toBe('var(--hub-card)');
      expect(t.vars['--hub-card-bd']).toBe('var(--hub-bd)');
    });
    it('outline', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, cardStyle: 'outline' }, false);
      expect(t.vars['--hub-card-bg']).toBe('transparent');
      expect(t.vars['--hub-card-bd']).toBe('var(--hub-bd2)');
    });
    it('tonal', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, cardStyle: 'tonal' }, false);
      expect(t.vars['--hub-card-bg']).toBe('var(--hub-soft)');
      expect(t.vars['--hub-card-bd']).toBe('transparent');
    });
  });

  describe('unknown enum values fall back to defaults without throwing', () => {
    it('unknown surface falls back to neutral', () => {
      const config = { ...DEFAULT_HUB_THEME, surface: 'galaxy' } as unknown as HubThemeConfig;
      expect(() => resolveHubTheme(config, false)).not.toThrow();
      const t = resolveHubTheme(config, false);
      expect(t.vars['--hub-bg']).toBe('#FAFAFA');
    });

    it('unknown radius falls back to soft', () => {
      const config = { ...DEFAULT_HUB_THEME, radius: 'huge' } as unknown as HubThemeConfig;
      expect(() => resolveHubTheme(config, false)).not.toThrow();
      const t = resolveHubTheme(config, false);
      expect(t.vars['--hub-r-card']).toBe('12px');
      expect(t.vars['--hub-r-ctl']).toBe('8px');
    });

    it('unknown cardStyle falls back to filled', () => {
      const config = { ...DEFAULT_HUB_THEME, cardStyle: 'glassy' } as unknown as HubThemeConfig;
      expect(() => resolveHubTheme(config, false)).not.toThrow();
      const t = resolveHubTheme(config, false);
      expect(t.vars['--hub-card-bg']).toBe('var(--hub-card)');
      expect(t.vars['--hub-card-bd']).toBe('var(--hub-bd)');
    });
  });

  describe('font var emission', () => {
    it('maps fontDisplay/fontBody ids to the right css stacks', () => {
      const t = resolveHubTheme(
        { ...DEFAULT_HUB_THEME, fontDisplay: 'space-grotesk', fontBody: 'manrope' },
        false,
      );
      expect(t.vars['--hub-font-display']).toBe(HUB_DISPLAY_FONTS['space-grotesk'].css);
      expect(t.vars['--hub-font-sans']).toBe(HUB_BODY_FONTS['manrope'].css);
    });

    it('defaults map to Fraunces / Instrument Sans stacks', () => {
      const t = resolveHubTheme(DEFAULT_HUB_THEME, false);
      expect(t.vars['--hub-font-display']).toBe(HUB_DISPLAY_FONTS['fraunces'].css);
      expect(t.vars['--hub-font-sans']).toBe(HUB_BODY_FONTS['instrument-sans'].css);
    });

    it('unknown font ids fall back to defaults', () => {
      const t = resolveHubTheme(
        { ...DEFAULT_HUB_THEME, fontDisplay: 'comic-sans', fontBody: 'papyrus' },
        false,
      );
      expect(t.vars['--hub-font-display']).toBe(HUB_DISPLAY_FONTS['fraunces'].css);
      expect(t.vars['--hub-font-sans']).toBe(HUB_BODY_FONTS['instrument-sans'].css);
    });
  });
});

describe('contrast floors across all 6 palettes', () => {
  // Structured identically to the LIGHT/DARK constants in theme.ts.
  const PALETTES: Record<string, { light: Record<string, string>; dark: Record<string, string> }> =
    {
      neutral: {
        light: { bg: '#FAFAFA', txt: '#171717', tx2: '#525252' },
        dark: { bg: '#0E0E0E', txt: '#F5F5F5', tx2: '#B3B3B3' },
      },
      warm: {
        light: { bg: '#FAF7F2', txt: '#1C1917', tx2: '#57534E' },
        dark: { bg: '#151210', txt: '#F5F0EB', tx2: '#B8B0A8' },
      },
      cool: {
        light: { bg: '#F7F9FB', txt: '#0F1728', tx2: '#4B5563' },
        dark: { bg: '#0D1017', txt: '#EEF2F7', tx2: '#A8B1BF' },
      },
    };

  // The module's own relativeLuminance() is a deliberately simplified (non-gamma-corrected)
  // linear formula, calibrated only for the accent-clamp thresholds (lum<0.18 / lum>0.85) —
  // it undershoots real contrast (e.g. it puts the *already-shipped* neutral palette's
  // tx2-vs-bg at ~2.77, below any reasonable floor). Per the brief's "or reimplement in the
  // test" option, this test uses the standard sRGB-gamma-corrected relative luminance so the
  // >=7 / >=4 floors are meaningful; theme.ts's simplified relativeLuminance is intentionally
  // left untouched for the accent-clamp pipeline.
  function wcagLuminance(hex: string): number {
    const int = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => c / 255);
    const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  }

  function naiveRatio(hexA: string, hexB: string): number {
    const lumA = wcagLuminance(hexA);
    const lumB = wcagLuminance(hexB);
    const lighter = Math.max(lumA, lumB);
    const darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
  }

  for (const [family, modes] of Object.entries(PALETTES)) {
    for (const [mode, colors] of Object.entries(modes)) {
      it(`${family} ${mode}: txt vs bg >= 7, tx2 vs bg >= 4`, () => {
        const txtRatio = naiveRatio(colors.txt, colors.bg);
        const tx2Ratio = naiveRatio(colors.tx2, colors.bg);
        expect(txtRatio).toBeGreaterThanOrEqual(7);
        expect(tx2Ratio).toBeGreaterThanOrEqual(4);
      });
    }
  }
});

describe('buildGoogleFontsHref', () => {
  it('returns null for the defaults', () => {
    expect(buildGoogleFontsHref('fraunces', 'instrument-sans')).toBeNull();
  });

  it('custom display only', () => {
    expect(buildGoogleFontsHref('space-grotesk', 'instrument-sans')).toBe(
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap',
    );
  });

  it('custom body only', () => {
    expect(buildGoogleFontsHref('fraunces', 'manrope')).toBe(
      'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap',
    );
  });

  it('both custom, display first then body', () => {
    expect(buildGoogleFontsHref('space-grotesk', 'manrope')).toBe(
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&display=swap',
    );
  });

  it('unknown ids are treated as defaults', () => {
    expect(buildGoogleFontsHref('comic-sans', 'papyrus')).toBeNull();
    expect(buildGoogleFontsHref('comic-sans', 'manrope')).toBe(
      'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap',
    );
  });
});

describe('font allowlist sync (mirrors supabase/migrations/20260731000001_hub_branding_columns.sql CHECK constraints)', () => {
  it('HUB_DISPLAY_FONTS keys match the SQL CHECK allowlist', () => {
    expect(Object.keys(HUB_DISPLAY_FONTS)).toEqual([
      'fraunces',
      'playfair-display',
      'dm-serif-display',
      'space-grotesk',
      'sora',
      'lora',
    ]);
  });

  it('HUB_BODY_FONTS keys match the SQL CHECK allowlist', () => {
    expect(Object.keys(HUB_BODY_FONTS)).toEqual([
      'instrument-sans',
      'inter',
      'dm-sans',
      'manrope',
      'public-sans',
    ]);
  });
});
