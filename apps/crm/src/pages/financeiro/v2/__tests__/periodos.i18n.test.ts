import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { rotuloPeriodo } from '../periodos';

describe('rotuloPeriodo', () => {
  afterEach(() => i18n.changeLanguage('pt'));

  const mes = { inicio: '2026-10-01', fim: '2026-11-01', rotulo: 'out 2026' };
  const meio = { inicio: '2026-10-15', fim: '2026-11-15', rotulo: '15 out a 14 nov' };
  const virada = {
    inicio: '2025-12-15',
    fim: '2026-01-15',
    rotulo: '15 dez 2025 a 14 jan 2026',
  };

  it('keeps the server label in Portuguese', () => {
    expect(rotuloPeriodo(mes)).toBe('out 2026');
    expect(rotuloPeriodo(meio)).toBe('15 out a 14 nov');
    expect(rotuloPeriodo(virada)).toBe('15 dez 2025 a 14 jan 2026');
  });

  it('rebuilds the label from the dates in English', async () => {
    await i18n.changeLanguage('en');
    expect(rotuloPeriodo(mes)).toBe('Oct 2026');
    expect(rotuloPeriodo(meio)).toBe('Oct 15 to Nov 14');
    expect(rotuloPeriodo(virada)).toBe('Dec 15, 2025 to Jan 14, 2026');
  });

  it('a partial period starting on day 1 is a span, not a month', async () => {
    await i18n.changeLanguage('en');
    expect(
      rotuloPeriodo({ inicio: '2026-10-01', fim: '2026-10-15', rotulo: '1 out a 14 out' }),
    ).toBe('Oct 1 to Oct 14');
  });
});
