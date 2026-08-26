import { describe, expect, it } from 'vitest';
import { shouldAutoStartTour } from '../tour/tourGating';

const BASE = {
  isLoading: false,
  alreadyStarted: false,
  tourDone: false,
  showExample: true,
  wizardOpen: false,
};

describe('shouldAutoStartTour', () => {
  it('inicia no primeiro board de exemplo', () => {
    expect(shouldAutoStartTour(BASE)).toBe(true);
  });

  it('NUNCA inicia com o wizard de novo fluxo aberto (deep link do guia)', () => {
    // Regression: ?novo-fluxo=1 em workspace vazio abria dois overlays.
    expect(shouldAutoStartTour({ ...BASE, wizardOpen: true })).toBe(false);
  });

  it('não inicia carregando, repetido, feito ou sem board de exemplo', () => {
    expect(shouldAutoStartTour({ ...BASE, isLoading: true })).toBe(false);
    expect(shouldAutoStartTour({ ...BASE, alreadyStarted: true })).toBe(false);
    expect(shouldAutoStartTour({ ...BASE, tourDone: true })).toBe(false);
    expect(shouldAutoStartTour({ ...BASE, showExample: false })).toBe(false);
  });
});
