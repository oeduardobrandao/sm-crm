import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { formatSearchDate, searchTypeLabel } from '../searchModel';

const NOW = new Date(2026, 9, 21);

describe('search model follows the UI language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('keeps the Portuguese labels and dates in pt', () => {
    expect(searchTypeLabel('post')).toBe('Postagens');
    expect(formatSearchDate('2026-10-02T12:00:00', NOW)).toBe('2 out');
    expect(formatSearchDate('2025-03-04T12:00:00', NOW)).toBe('4 mar 2025');
  });

  it('switches labels and dates to English', async () => {
    await i18n.changeLanguage('en');
    expect(searchTypeLabel('post')).toBe('Posts');
    expect(formatSearchDate('2026-10-02T12:00:00', NOW)).toBe('Oct 2');
    expect(formatSearchDate('2025-03-04T12:00:00', NOW)).toBe('Mar 4 2025');
    expect(i18n.t('search.createdAt', { date: 'Oct 2' })).toBe('Created Oct 2');
  });
});
