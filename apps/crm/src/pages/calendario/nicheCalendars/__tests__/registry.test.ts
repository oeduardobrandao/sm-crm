import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NICHE_CALENDARS, readStoredNicheKey, writeStoredNicheKey } from '../registry';
import type { NicheEventType } from '../types';

const VALID_TYPES: NicheEventType[] = ['br', 'world', 'prof', 'week', 'month'];
// 'week'/'month' are valid tags (thematic-week/month events carry them alongside 'br'/'world' so
// search still finds them) but never get a dedicated filter chip — same convention medico.ts
// already used before this niche system existed.
const UNIVERSAL_TAGS = new Set(['br', 'world', 'prof', 'week', 'month']);
const MONTH_ORDER = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

describe('NICHE_CALENDARS data integrity', () => {
  it('contains exactly the 5 expected niches, in order', () => {
    expect(NICHE_CALENDARS.map((n) => n.key)).toEqual([
      'medico',
      'juridico',
      'varejo',
      'beleza-estetica',
      'gastronomia',
    ]);
  });

  it('has no duplicate niche keys', () => {
    const keys = NICHE_CALENDARS.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(NICHE_CALENDARS)(
    '$label: has exactly 12 months, in order, with unique 01-12 nums',
    (niche) => {
      expect(niche.data).toHaveLength(12);
      expect(niche.data.map((m) => m.month)).toEqual(MONTH_ORDER);
      expect(niche.data.map((m) => m.num)).toEqual([
        '01',
        '02',
        '03',
        '04',
        '05',
        '06',
        '07',
        '08',
        '09',
        '10',
        '11',
        '12',
      ]);
    },
  );

  it.each(NICHE_CALENDARS)('$label: every event has a valid type and non-empty tags', (niche) => {
    niche.data.forEach((month) => {
      month.events.forEach((event) => {
        expect(VALID_TYPES).toContain(event.type);
        expect(event.tags.length).toBeGreaterThan(0);
      });
    });
  });

  it.each(NICHE_CALENDARS)(
    '$label: every niche-specific tag has a filterLabels entry, and every filterLabels entry is used',
    (niche) => {
      const usedNicheTags = new Set<string>();
      niche.data.forEach((month) => {
        month.events.forEach((event) => {
          event.tags.forEach((tag) => {
            if (!UNIVERSAL_TAGS.has(tag)) usedNicheTags.add(tag);
          });
        });
      });
      const labelKeys = new Set(Object.keys(niche.filterLabels));

      const orphanTags = [...usedNicheTags].filter((tag) => !labelKeys.has(tag));
      expect(orphanTags).toEqual([]);

      const deadChips = [...labelKeys].filter((key) => !usedNicheTags.has(key));
      expect(deadChips).toEqual([]);
    },
  );
});

describe('cross-month movable holidays', () => {
  // Carnaval, Páscoa and Corpus Christi don't have a fixed month — Carnaval can fall in
  // fevereiro or março, Páscoa in março or abril, Corpus Christi (Páscoa+60d) in maio or junho.
  // A niche that only lists one of these under a single NicheMonth card silently hides it from
  // users browsing the *other* possible month in years it lands there (caught by Codex review on
  // apps/crm/src/pages/calendario/nicheCalendars/gastronomia.ts — Páscoa was Abril-only).
  const MOVABLE_HOLIDAY_PATTERNS = [/carnaval/i, /páscoa|pascoa/i, /corpus christi/i];

  it.each(NICHE_CALENDARS)('$label: every movable-holiday event spans 2+ months', (niche) => {
    for (const pattern of MOVABLE_HOLIDAY_PATTERNS) {
      const monthsWithMatch = niche.data
        .filter((month) => month.events.some((e) => pattern.test(e.name)))
        .map((month) => month.month);
      if (monthsWithMatch.length === 0) continue; // this niche doesn't reference this holiday
      expect(monthsWithMatch.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('niche persistence helpers', () => {
  const KEY = 'mesaas:calendario:ultimoNicho';

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the fallback when nothing is stored', () => {
    expect(readStoredNicheKey(['medico', 'juridico'], 'medico')).toBe('medico');
  });

  it('returns the stored value when it matches a valid key', () => {
    localStorage.setItem(KEY, 'juridico');
    expect(readStoredNicheKey(['medico', 'juridico'], 'medico')).toBe('juridico');
  });

  it('falls back when the stored value is not a known key', () => {
    localStorage.setItem(KEY, 'nicho-removido');
    expect(readStoredNicheKey(['medico', 'juridico'], 'medico')).toBe('medico');
  });

  it('falls back when storage.getItem throws (private mode / quota)', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(readStoredNicheKey(['medico'], 'medico')).toBe('medico');
    getSpy.mockRestore();
  });

  it('persists a valid key so a later read returns it', () => {
    writeStoredNicheKey('varejo');
    expect(localStorage.getItem(KEY)).toBe('varejo');
  });

  it('does not throw when storage.setItem throws', () => {
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => writeStoredNicheKey('varejo')).not.toThrow();
    setSpy.mockRestore();
  });
});
