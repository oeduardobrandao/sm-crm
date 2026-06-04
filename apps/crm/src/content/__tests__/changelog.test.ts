import { describe, it, expect } from 'vitest';
import { changelogSchema, parseReleases } from '../changelog.schema';

const VALID = {
  lastMergedAt: '2026-06-03T13:42:12Z',
  releases: [
    {
      date: '2026-06-03',
      summary: 'Resumo da semana.',
      items: [
        { type: 'feature', area: 'Entregas', title: 'Título', description: 'Descrição.', pr: 93 },
      ],
    },
  ],
};

describe('changelogSchema', () => {
  it('accepts a valid document', () => {
    expect(changelogSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const bad = structuredClone(VALID);
    bad.releases[0].items[0].type = 'breaking';
    expect(changelogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    const bad = structuredClone(VALID);
    bad.releases[0].date = '03/06/2026';
    expect(changelogSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a release with no items', () => {
    const bad = structuredClone(VALID);
    bad.releases[0].items = [];
    expect(changelogSchema.safeParse(bad).success).toBe(false);
  });
});

describe('parseReleases', () => {
  it('returns releases for valid data', () => {
    expect(parseReleases(VALID)).toHaveLength(1);
  });

  it('returns [] for invalid data (page safety net)', () => {
    expect(parseReleases({ nope: true })).toEqual([]);
  });
});
