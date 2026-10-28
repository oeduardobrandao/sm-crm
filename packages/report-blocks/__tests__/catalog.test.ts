import { describe, expect, it } from 'vitest';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '../catalog';
import { BLOCK_TYPES, TIKTOK_BLOCK_PREFIX } from '../types';

describe('WIDGET_CATALOG', () => {
  it('cobre todos os tipos de bloco, sem duplicatas', () => {
    const types = WIDGET_CATALOG.map((w) => w.type);
    expect(new Set(types).size).toBe(types.length);
    // tiktok_* ganham entrada no catálogo junto com os renderers (Part B, task B4).
    const instagramAndNeutral = BLOCK_TYPES.filter((t) => !t.startsWith(TIKTOK_BLOCK_PREFIX));
    expect([...types].sort()).toEqual([...instagramAndNeutral].sort());
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
