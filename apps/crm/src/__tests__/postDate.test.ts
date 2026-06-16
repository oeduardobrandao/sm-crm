import { describe, expect, it } from 'vitest';
import { formatPostDate, formatPostDateFull } from '../utils/postDate';

describe('formatPostDate', () => {
  it('omits the year in the current year and drops minutes when :00', () => {
    const d = new Date(new Date().getFullYear(), 5, 8, 14, 0); // 8 Jun 14:00, current year
    expect(formatPostDate(d.toISOString())).toBe('8 jun · 14h');
  });

  it('shows minutes when non-zero', () => {
    const d = new Date(new Date().getFullYear(), 5, 18, 18, 30);
    expect(formatPostDate(d.toISOString())).toBe('18 jun · 18h30');
  });

  it('returns empty string for an invalid date', () => {
    expect(formatPostDate('not-a-date')).toBe('');
    expect(formatPostDateFull('not-a-date')).toBe('');
  });
});
