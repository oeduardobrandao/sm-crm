import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { formatUtcDateBR } from '../PagarmeCheckoutDialog';

describe('formatUtcDateBR (en)', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  it('keeps dd/MM/yyyy in Portuguese', () => {
    expect(formatUtcDateBR('2026-09-12T00:00:00.000Z')).toBe('12/09/2026');
  });

  it('uses MM/dd/yyyy in English without a timezone shift', async () => {
    await i18n.changeLanguage('en');
    expect(formatUtcDateBR('2026-09-12T00:00:00.000Z')).toBe('09/12/2026');
  });
});
