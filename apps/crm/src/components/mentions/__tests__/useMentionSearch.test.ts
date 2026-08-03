import { describe, expect, it } from 'vitest';
import {
  normalizeForSearch,
  filterAndCapMentions,
  MAX_RESULTS_PER_SECTION,
} from '../useMentionSearch';

describe('normalizeForSearch', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeForSearch('João')).toBe('joao');
    expect(normalizeForSearch('CLÍNICA')).toBe('clinica');
    expect(normalizeForSearch('Ágata Núñez')).toBe('agata nunez');
  });

  it('is a no-op for plain lowercase ASCII', () => {
    expect(normalizeForSearch('ana')).toBe('ana');
  });
});

describe('filterAndCapMentions', () => {
  const items = [
    { label: 'Ana' },
    { label: 'André' },
    { label: 'Bruno' },
    { label: 'Camila' },
    { label: 'Carla' },
    { label: 'Caio' },
    { label: 'Clínica São José' },
  ];

  it('matches accent-insensitively and case-insensitively', () => {
    expect(filterAndCapMentions(items, 'andre').map((i) => i.label)).toEqual(['André']);
    expect(filterAndCapMentions(items, 'ANDRÉ').map((i) => i.label)).toEqual(['André']);
    expect(filterAndCapMentions(items, 'clinica').map((i) => i.label)).toEqual([
      'Clínica São José',
    ]);
  });

  it('matches on a substring, not just a prefix', () => {
    expect(filterAndCapMentions(items, 'an').map((i) => i.label)).toEqual(['Ana', 'André']);
  });

  it('returns everything (capped) for an empty/whitespace query', () => {
    const result = filterAndCapMentions(items, '   ');
    expect(result).toHaveLength(MAX_RESULTS_PER_SECTION);
    expect(result.map((i) => i.label)).toEqual(
      items.slice(0, MAX_RESULTS_PER_SECTION).map((i) => i.label),
    );
  });

  it('caps results at the default limit (5)', () => {
    const result = filterAndCapMentions(items, 'ca');
    // Camila, Carla, Caio, Clínica São José all contain "ca" (case/accent-insensitive)
    expect(result.length).toBeLessThanOrEqual(MAX_RESULTS_PER_SECTION);
  });

  it('honors a custom limit', () => {
    expect(filterAndCapMentions(items, '', 2)).toHaveLength(2);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterAndCapMentions(items, 'zzz')).toEqual([]);
  });
});
