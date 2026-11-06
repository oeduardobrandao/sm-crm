import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { formatDate } from '../core';

describe('formatDate follows the UI language', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  it('prints day-first in Portuguese', () => {
    expect(formatDate('2026-05-13')).toBe('13/05/2026');
  });

  it('prints month-first in English', async () => {
    await i18n.changeLanguage('en');
    expect(formatDate('2026-05-13')).toBe('5/13/2026');
  });
});
