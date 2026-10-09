import { describe, expect, it } from 'vitest';
import {
  resolveHubTheme,
  relativeLuminance,
  buildGoogleFontsHref,
  DEFAULT_HUB_THEME,
  HUB_DISPLAY_FONTS,
  HUB_BODY_FONTS,
  PALETTES,
  HUB_FONT_PAIRINGS,
  PAUTA_WARM,
  PAUTA_STATUS,
  contrastRatio,
  readablePrimary,
  effectiveHubFonts,
  hubFontOptions,
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
      expect(t.vars['--hub-tx3']).toBe('#707070');
      expect(t.vars['--hub-bd']).toBe('rgba(0,0,0,.08)');
      expect(t.vars['--hub-bd2']).toBe('rgba(0,0,0,.2)');
      expect(t.vars['--hub-soft']).toBe('#F4F4F4');
      expect(t.vars['--hub-primary']).toBe('var(--hub-txt)');
      expect(t.vars['--hub-primary-fg']).toBe('var(--hub-card)');
      expect(t.vars['--hub-ring']).toBe('color-mix(in srgb, var(--hub-txt) 15%, transparent)');
      expect(t.vars['--hub-r-card']).toBe('12px');
      expect(t.vars['--hub-r-ctl']).toBe('12px');
      expect(t.vars['--hub-card-bg']).toBe('var(--hub-card)');
      expect(t.vars['--hub-card-bd']).toBe('var(--hub-bd)');
    });

    it('dark', () => {
      const t = resolveHubTheme(DEFAULT_HUB_THEME, true);
      expect(t.vars['--hub-bg']).toBe('#0E0E0E');
      expect(t.vars['--hub-card']).toBe('#181818');
      expect(t.vars['--hub-txt']).toBe('#F5F5F5');
      expect(t.vars['--hub-tx2']).toBe('#B3B3B3');
      expect(t.vars['--hub-tx3']).toBe('#8D8D8D');
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
      expect(t.vars['--hub-r-ctl']).toBe('12px');
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

  describe('surface emission', () => {
    it('warm light', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, surface: 'warm' }, false);
      expect(t.vars['--hub-bg']).toBe(PALETTES.warm.light.bg);
      expect(t.vars['--hub-card']).toBe(PALETTES.warm.light.card);
      expect(t.vars['--hub-txt']).toBe(PALETTES.warm.light.txt);
    });

    it('warm dark', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, surface: 'warm' }, true);
      expect(t.vars['--hub-bg']).toBe(PALETTES.warm.dark.bg);
      expect(t.vars['--hub-card']).toBe(PALETTES.warm.dark.card);
      expect(t.vars['--hub-txt']).toBe(PALETTES.warm.dark.txt);
    });

    it('cool light', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, surface: 'cool' }, false);
      expect(t.vars['--hub-bg']).toBe(PALETTES.cool.light.bg);
      expect(t.vars['--hub-card']).toBe(PALETTES.cool.light.card);
      expect(t.vars['--hub-txt']).toBe(PALETTES.cool.light.txt);
    });

    it('cool dark', () => {
      const t = resolveHubTheme({ ...DEFAULT_HUB_THEME, surface: 'cool' }, true);
      expect(t.vars['--hub-bg']).toBe(PALETTES.cool.dark.bg);
      expect(t.vars['--hub-card']).toBe(PALETTES.cool.dark.card);
      expect(t.vars['--hub-txt']).toBe(PALETTES.cool.dark.txt);
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
      expect(t.vars['--hub-r-ctl']).toBe('12px');
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
  // Reads the real palette data straight from theme.ts's exported PALETTES — no
  // hand-duplicated hex table here, so this can't drift from what resolveHubTheme()
  // actually emits (see the 'surface emission' tests above for the same principle).

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

  it('includeDefaults: true inclui as familias padrao mesmo quando sao as escolhidas', () => {
    expect(buildGoogleFontsHref('fraunces', 'instrument-sans', { includeDefaults: true })).toBe(
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600;700&display=swap',
    );
  });

  it('includeDefaults: true com IDs desconhecidos ainda cai nos defaults e os inclui', () => {
    expect(buildGoogleFontsHref('comic-sans', 'papyrus', { includeDefaults: true })).toBe(
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600;700&display=swap',
    );
  });

  it('includeDefaults ausente ou false preserva o comportamento atual (sem regressao)', () => {
    expect(buildGoogleFontsHref('fraunces', 'instrument-sans')).toBeNull();
    expect(buildGoogleFontsHref('fraunces', 'instrument-sans', {})).toBeNull();
    expect(
      buildGoogleFontsHref('fraunces', 'instrument-sans', { includeDefaults: false }),
    ).toBeNull();
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
      'bricolage-grotesque',
    ]);
  });

  it('HUB_BODY_FONTS keys match the SQL CHECK allowlist', () => {
    expect(Object.keys(HUB_BODY_FONTS)).toEqual([
      'instrument-sans',
      'inter',
      'dm-sans',
      'manrope',
      'public-sans',
      'figtree',
    ]);
  });
});

describe('surface presets: tx3 contrast (WCAG AA)', () => {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const [surface, modes] of Object.entries(PALETTES)) {
    for (const [mode, p] of Object.entries(modes)) {
      it(`${surface} ${mode}: tx3 is >= 4.5:1 on bg, card and soft`, () => {
        for (const bg of [p.bg, p.card, p.soft]) {
          expect(ratio(p.tx3, bg)).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  for (const [mode, p] of Object.entries(PAUTA_WARM)) {
    it(`pauta warm ${mode}: tx3 is >= 4.5:1 on bg, card and soft`, () => {
      for (const bg of [p.bg, p.card, p.soft]) expect(ratio(p.tx3, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('readable primary (Pauta)', () => {
  const brands = [
    '#f97316',
    '#0ea5e9',
    '#ec4899',
    '#f43f5e',
    '#d946ef',
    '#8b5cf6',
    '#ffbf30',
    '#1a1a2e',
  ];
  for (const hex of brands) {
    it(`${hex}: primary-fg on primary >= 4.5`, () => {
      const { primary, fg } = readablePrimary(hex);
      expect(contrastRatio(fg, primary)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('keeps the brand color when a foreground already reaches 4.5', () => {
    expect(readablePrimary('#f97316').primary).toBe('#f97316'); // ink passes
    expect(readablePrimary('#0f766e').primary).toBe('#0f766e'); // white passes
  });
  it('resolveHubTheme Pauta: primary-fg on primary >= 4.5 in both modes', () => {
    for (const hex of ['#f97316', '#0ea5e9', '#ec4899', '#f43f5e', '#8b5cf6']) {
      for (const dark of [false, true]) {
        const v = resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: hex }, dark, 'pauta').vars;
        expect(contrastRatio(v['--hub-primary-fg'], v['--hub-primary'])).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });
  it('darkens a mid-tone toward ink when neither foreground reaches 4.5', () => {
    const r = readablePrimary('#8b5cf6');
    expect(r.primary).not.toBe('#8b5cf6');
    expect(r.fg).toBe('#ffffff');
  });
});

describe("resolveHubTheme look='pauta'", () => {
  const base = { ...DEFAULT_HUB_THEME, accent: '#f97316' };
  it('primary is the readable brand color even with customized: false', () => {
    const v = resolveHubTheme(base, false, 'pauta').vars;
    expect(v['--hub-primary']).toBe('#f97316');
    expect(v['--hub-primary-fg']).toBe('#171717');
    expect(v['--hub-ring']).toBe('color-mix(in srgb, #f97316 22%, transparent)');
    expect(v['--hub-acc']).toBe('#f97316');
  });
  it('warm surface uses PAUTA_WARM in Pauta and the classic palette otherwise', () => {
    const warm = { ...base, surface: 'warm' as const, customized: true };
    expect(resolveHubTheme(warm, false, 'pauta').vars['--hub-bg']).toBe('#F8F5F3');
    expect(resolveHubTheme(warm, true, 'pauta').vars['--hub-bg']).toBe('#141110');
    expect(resolveHubTheme(warm, false).vars['--hub-bg']).toBe('#FAF7F2');
  });
  it('non-customized Pauta uses the Assinatura fonts; customized keeps the stored ones', () => {
    expect(resolveHubTheme(base, false, 'pauta').vars['--hub-font-display']).toContain(
      'Bricolage Grotesque',
    );
    expect(resolveHubTheme(base, false, 'pauta').vars['--hub-font-sans']).toContain('Figtree');
    const custom = { ...base, customized: true, fontDisplay: 'fraunces', fontBody: 'inter' };
    expect(resolveHubTheme(custom, false, 'pauta').vars['--hub-font-display']).toContain(
      'Fraunces',
    );
  });
  it('display weight is 500 for Fraunces and 600 otherwise', () => {
    const fr = { ...base, customized: true, fontDisplay: 'fraunces' };
    expect(resolveHubTheme(fr, false, 'pauta').vars['--hub-display-weight']).toBe('500');
    expect(resolveHubTheme(base, false, 'pauta').vars['--hub-display-weight']).toBe('600');
  });
  it('radius tokens per preset', () => {
    const r = (radius: 'square' | 'soft' | 'pill') =>
      resolveHubTheme({ ...base, customized: true, radius }, false, 'pauta').vars;
    expect([
      r('square')['--hub-r-chip'],
      r('soft')['--hub-r-chip'],
      r('pill')['--hub-r-chip'],
    ]).toEqual(['3px', '8px', '999px']);
    expect([
      r('square')['--hub-r-tile'],
      r('soft')['--hub-r-tile'],
      r('pill')['--hub-r-tile'],
    ]).toEqual(['0px', '8px', '14px']);
    expect([
      r('square')['--hub-r-dot'],
      r('soft')['--hub-r-dot'],
      r('pill')['--hub-r-dot'],
    ]).toEqual(['0px', '2px', '999px']);
  });
  it('card shadow only on filled light', () => {
    expect(resolveHubTheme(base, false, 'pauta').vars['--hub-shadow-card']).toBe(
      '0 1px 2px rgba(16,16,16,.05)',
    );
    expect(resolveHubTheme(base, true, 'pauta').vars['--hub-shadow-card']).toBe('none');
    expect(
      resolveHubTheme({ ...base, customized: true, cardStyle: 'outline' }, false, 'pauta').vars[
        '--hub-shadow-card'
      ],
    ).toBe('none');
  });
  it('status tokens are emitted and done reads the surface', () => {
    const v = resolveHubTheme(base, false, 'pauta').vars;
    expect(v['--hub-st-wait-fg']).toBe('#8A5300');
    expect(v['--hub-st-done-fg']).toBe('var(--hub-tx2)');
    expect(v['--hub-st-done-bg']).toBe('var(--hub-soft)');
  });
});

describe('classic stays as it was', () => {
  it('existing vars are identical with and without the look argument', () => {
    for (const dark of [false, true]) {
      for (const cfg of [
        { ...DEFAULT_HUB_THEME, accent: '#f97316' },
        {
          ...DEFAULT_HUB_THEME,
          accent: '#8b5cf6',
          customized: true,
          surface: 'warm' as const,
          radius: 'pill' as const,
        },
      ]) {
        const a = resolveHubTheme(cfg, dark).vars;
        const b = resolveHubTheme(cfg, dark, 'classic').vars;
        expect(b).toEqual(a);
        // the 19 pre-Pauta vars keep their pre-Pauta values
        expect(a['--hub-primary']).toBe(cfg.customized ? '#8b5cf6' : 'var(--hub-txt)');
      }
    }
  });
  it('classic accFg keeps the linear-luminance pick', () => {
    expect(
      resolveHubTheme({ ...DEFAULT_HUB_THEME, accent: '#f97316' }, false).vars['--hub-acc-fg'],
    ).toBe('#ffffff');
  });
});

describe('Pauta status tokens contrast (>= 4.5 on card and bg of every surface)', () => {
  for (const mode of ['light', 'dark'] as const) {
    const palettes = [PALETTES.neutral[mode], PAUTA_WARM[mode], PALETTES.cool[mode]];
    for (const [tone, { fg }] of Object.entries(PAUTA_STATUS[mode])) {
      if (tone === 'done') continue; // tx2 on soft, covered by the palette floors
      it(`${mode} ${tone}`, () => {
        for (const p of palettes) {
          expect(contrastRatio(fg, p.card)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(fg, p.bg)).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

describe('effectiveHubFonts', () => {
  it('classic: defaults unless customized', () => {
    expect(effectiveHubFonts('classic', false, { display: 'sora', body: 'inter' })).toEqual({
      display: 'fraunces',
      body: 'instrument-sans',
    });
    expect(effectiveHubFonts('classic', true, { display: 'sora', body: 'inter' })).toEqual({
      display: 'sora',
      body: 'inter',
    });
  });
  it('pauta: Assinatura unless customized', () => {
    expect(effectiveHubFonts('pauta', false, {})).toEqual({
      display: 'bricolage-grotesque',
      body: 'figtree',
    });
    expect(
      effectiveHubFonts('pauta', true, { display: 'fraunces', body: 'instrument-sans' }),
    ).toEqual({ display: 'fraunces', body: 'instrument-sans' });
  });
  it('customized with missing ids falls back to the classic defaults', () => {
    expect(effectiveHubFonts('pauta', true, { display: null, body: undefined })).toEqual({
      display: 'fraunces',
      body: 'instrument-sans',
    });
  });
});

describe('hubFontOptions', () => {
  const cur = { display: 'fraunces', body: 'instrument-sans' };
  it('hides the Assinatura ids and pair without the flag', () => {
    const o = hubFontOptions(false, cur);
    expect(o.display.map(([id]) => id)).not.toContain('bricolage-grotesque');
    expect(o.body.map(([id]) => id)).not.toContain('figtree');
    expect(o.pairings.map((p) => p.label)).not.toContain('Assinatura');
  });
  it('shows them with the flag, Assinatura first', () => {
    const o = hubFontOptions(true, cur);
    expect(o.display.map(([id]) => id)).toContain('bricolage-grotesque');
    expect(o.pairings[0].label).toBe('Assinatura');
    expect(o.pairings).toEqual(HUB_FONT_PAIRINGS);
  });
  it('keeps an already-stored Assinatura id visible without the flag', () => {
    const o = hubFontOptions(false, { display: 'bricolage-grotesque', body: 'figtree' });
    expect(o.display.map(([id]) => id)).toContain('bricolage-grotesque');
    expect(o.body.map(([id]) => id)).toContain('figtree');
    expect(o.pairings.map((p) => p.label)).toContain('Assinatura');
  });
});
