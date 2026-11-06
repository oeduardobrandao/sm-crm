import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import {
  endOfLocalDay,
  formatPostDate,
  formatPostWeekday,
  parseLocalISODate,
  toLocalISODate,
} from '../postDate';

describe('local-day helpers', () => {
  it('toLocalISODate usa os componentes locais, nunca o dia UTC', () => {
    const late = new Date(2026, 8, 15, 23, 30);
    const early = new Date(2026, 8, 15, 0, 30);
    expect(toLocalISODate(late)).toBe('2026-09-15');
    expect(toLocalISODate(early)).toBe('2026-09-15');
    expect(toLocalISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('parseLocalISODate devolve meia-noite local e null para lixo', () => {
    const d = parseLocalISODate('2026-09-15')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 15, 0]);
    expect(parseLocalISODate('2026-09-15T12:00:00Z')!.getDate()).toBe(15);
    expect(parseLocalISODate('')).toBeNull();
    expect(parseLocalISODate('nope')).toBeNull();
  });
  it('endOfLocalDay é 23:59:59.999 local do mesmo dia', () => {
    const e = endOfLocalDay(new Date(2026, 8, 15, 9, 0));
    expect([
      e.getDate(),
      e.getHours(),
      e.getMinutes(),
      e.getSeconds(),
      e.getMilliseconds(),
    ]).toEqual([15, 23, 59, 59, 999]);
  });
});

describe('postDate in English', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('formats dates the English way', async () => {
    await i18n.changeLanguage('en');
    const now = new Date();
    const y = now.getFullYear();
    expect(formatPostDate(new Date(y, 5, 8, 14, 0).toISOString())).toBe('Jun 8 · 2 PM');
    expect(formatPostDate(new Date(y, 6, 18, 18, 30).toISOString())).toBe('Jul 18 · 6:30 PM');
    expect(formatPostWeekday(new Date(y, 8, 24, 12).toISOString(), now)).toMatch(
      /^[A-Z][a-z]{2}, Sep 24$/,
    );
  });
});
