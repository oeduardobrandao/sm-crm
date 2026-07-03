// Pure derivations of usePostBrand (T3.1) — the matcher wiring itself is what's under test:
// deriveBrandFonts must resolve through the SHARED @mesaas/fonts matcher against the real
// committed manifest, so these assertions double as the "matcher consumption" spot-check the
// plan asks for.
import { describe, expect, it } from 'vitest';
import { deriveBrandColors, deriveBrandFonts } from '../hooks/usePostBrand';
import type { HubBrandRow } from '@/store';

function brand(overrides: Partial<HubBrandRow>): HubBrandRow {
  return { cliente_id: 1, ...overrides };
}

describe('deriveBrandColors', () => {
  it('normalizes valid hexes (missing # tolerated) and drops free-text garbage', () => {
    expect(
      deriveBrandColors(brand({ primary_color: 'EAB308', secondary_color: '#12151a' })),
    ).toEqual(['#eab308', '#12151a']);
    expect(
      deriveBrandColors(brand({ primary_color: 'azul', secondary_color: 'rgb(0,0,0)' })),
    ).toEqual([]);
    expect(deriveBrandColors(null)).toEqual([]);
  });
});

describe('deriveBrandFonts (shared matcher, real manifest)', () => {
  it('resolves exact, prefix and fuzzy names to manifest keys', () => {
    expect(deriveBrandFonts(brand({ font_primary: 'DM Sans' }))).toEqual([
      { raw: 'DM Sans', key: 'dm-sans' },
    ]);
    expect(deriveBrandFonts(brand({ font_primary: 'Playfair' }))).toEqual([
      { raw: 'Playfair', key: 'playfair-display' },
    ]);
  });

  it('keeps the raw name with key:null when unmatched — never guesses', () => {
    expect(deriveBrandFonts(brand({ font_primary: 'Comic Sans MS' }))).toEqual([
      { raw: 'Comic Sans MS', key: null },
    ]);
  });

  it('emits primary then secondary, skipping blanks', () => {
    expect(deriveBrandFonts(brand({ font_primary: '  ', font_secondary: 'Inter' }))).toEqual([
      { raw: 'Inter', key: 'inter' },
    ]);
    expect(deriveBrandFonts(null)).toEqual([]);
  });
});
