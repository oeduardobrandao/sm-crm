import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from '../tourSteps';

describe('TOUR_STEPS', () => {
  it('tem 8 passos na ordem página -> formulário', () => {
    expect(TOUR_STEPS).toHaveLength(8);
    expect(TOUR_STEPS[0].surface).toBe('page');
    expect(TOUR_STEPS.slice(1).every((s) => s.surface === 'dialog')).toBe(true);
  });

  it('só o passo 1 tem ctaKey', () => {
    expect(TOUR_STEPS[0].ctaKey).toBe('tour.step1Cta');
    expect(TOUR_STEPS.slice(1).every((s) => s.ctaKey === undefined)).toBe(true);
  });

  it('âncoras são únicas', () => {
    const anchors = TOUR_STEPS.map((s) => s.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('a ordem das âncoras segue o formulário', () => {
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual([
      'nova-automacao',
      'campo-nome',
      'campo-cliente',
      'campo-alvo',
      'campo-palavras',
      'campo-dm',
      'campo-botoes',
      'campo-resposta',
    ]);
  });
});
