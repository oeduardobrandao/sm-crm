import { describe, expect, it } from 'vitest';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '../catalog';
import { BLOCK_TYPES } from '../types';

describe('WIDGET_CATALOG', () => {
  it('cobre todos os 25 tipos de bloco, sem duplicatas', () => {
    const types = WIDGET_CATALOG.map((w) => w.type);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it('toda entrada tem label pt-BR não vazio e categoria válida', () => {
    for (const w of WIDGET_CATALOG) {
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.label).not.toContain('—');
      expect(WIDGET_CATEGORIES).toContain(w.category);
    }
  });

  it('a ordem de categorias começa em Números e termina em Estrutura', () => {
    expect(WIDGET_CATEGORIES[0]).toBe('Números');
    expect(WIDGET_CATEGORIES[WIDGET_CATEGORIES.length - 1]).toBe('Estrutura');
  });
});
