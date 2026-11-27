import { afterEach, describe, expect, it } from 'vitest';
import i18n from 'i18next';
import { formatTrialDate } from '../reverseTrial';
import { formatStorageBytes } from '../../components/usage/usage-meter-state';
import { formatNumber, formatPct } from '../../pages/analytics-tiktok/overviewModel';

// Display formats follow the UI language at call time (getIntlLocale), not a pt-BR constant.
describe('display formats follow the app language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('keeps the Brazilian output in pt', () => {
    expect(formatTrialDate('2026-12-08T15:00:00Z')).toBe('8 de dezembro');
    expect(formatStorageBytes(4.5 * 1024 ** 3)).toBe('4,5 GB');
    expect(formatNumber(15320)).toBe('15.320');
    expect(formatPct(6.8)).toBe('6,80%');
  });

  it('uses English names and separators in en', async () => {
    await i18n.changeLanguage('en');
    expect(formatTrialDate('2026-12-08T15:00:00Z')).toBe('December 8');
    expect(formatStorageBytes(4.5 * 1024 ** 3)).toBe('4.5 GB');
    expect(formatNumber(15320)).toBe('15,320');
    expect(formatPct(6.8)).toBe('6.80%');
  });
});
