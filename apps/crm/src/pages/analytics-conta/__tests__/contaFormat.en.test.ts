import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import {
  dayFull,
  dayShort,
  formatMediaType,
  formatPublishedAt,
  formatSyncedAgo,
  hourText,
} from '../contaFormat';

describe('contaFormat in English', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('translates labels, weekday names and the publication time', async () => {
    await i18n.changeLanguage('en');
    expect(formatMediaType('CAROUSEL_ALBUM')).toBe('Carousel');
    expect(dayShort('Sáb')).toBe('Sat');
    expect(dayFull('Sab')).toBe('Saturday');
    expect(hourText('14h')).toBe('14:00');
    expect(formatPublishedAt('2026-11-21T21:02:00Z')).toBe('Published on Nov 21 at 6:02 PM');
    expect(formatSyncedAgo('2026-11-23T10:00:00Z', new Date('2026-11-23T12:00:00Z'))).toBe(
      'Updated 2 h ago',
    );
  });

  it('keeps Portuguese weekday and hour labels as the API sends them', () => {
    expect(dayShort('Sáb')).toBe('Sáb');
    expect(hourText('14h')).toBe('14h');
    expect(dayFull('Sáb')).toBe('Sábado');
  });
});
