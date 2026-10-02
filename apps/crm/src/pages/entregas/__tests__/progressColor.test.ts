import { describe, expect, it } from 'vitest';
import { progressColor } from '../progressColor';

const YELLOW = 'hsl(45 93% 47%)';
const GREEN = 'hsl(153 60% 53%)';

describe('progressColor', () => {
  it('começa amarelo no primeiro trecho visível e termina verde na última etapa', () => {
    // idx 0 tem largura 0%; a primeira barra visível é a da idx 1.
    expect(progressColor(0, 5)).toBe(YELLOW);
    expect(progressColor(1, 5)).toBe(YELLOW);
    expect(progressColor(4, 5)).toBe(GREEN);
  });

  it('esverdeia a cada etapa visível', () => {
    const hues = [1, 2, 3, 4].map((i) => Number(/hsl\((\d+)/.exec(progressColor(i, 5))![1]));
    expect(hues).toEqual([...hues].sort((a, b) => a - b));
    expect(new Set(hues).size).toBe(4);
  });

  it('fluxos curtos e índices fora da faixa', () => {
    expect(progressColor(0, 2)).toBe(YELLOW);
    expect(progressColor(1, 2)).toBe(GREEN);
    expect(progressColor(0, 1)).toBe(GREEN);
    expect(progressColor(-1, 4)).toBe(YELLOW);
    expect(progressColor(9, 4)).toBe(GREEN);
  });
});
