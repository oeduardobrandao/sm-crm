import { describe, expect, it } from 'vitest';
import { STANDARD_PRESETS, presetDurationDays } from '../presets';

describe('STANDARD_PRESETS', () => {
  it('has 5 presets with unique ids', () => {
    expect(STANDARD_PRESETS).toHaveLength(5);
    expect(new Set(STANDARD_PRESETS.map((p) => p.id)).size).toBe(5);
  });

  it('every preset has at least one etapa and every etapa has a non-empty name', () => {
    for (const p of STANDARD_PRESETS) {
      expect(p.etapas.length).toBeGreaterThan(0);
      for (const e of p.etapas) expect(e.nome.trim().length).toBeGreaterThan(0);
    }
  });

  it('every data_entrega preset contains an aprovacao_cliente anchor', () => {
    for (const p of STANDARD_PRESETS.filter((p) => p.modo_prazo === 'data_entrega')) {
      expect(p.etapas.some((e) => e.tipo === 'aprovacao_cliente')).toBe(true);
    }
  });

  it('aprovacao-dupla has exactly two approval etapas', () => {
    const dupla = STANDARD_PRESETS.find((p) => p.id === 'aprovacao-dupla')!;
    expect(dupla.etapas.filter((e) => e.tipo === 'aprovacao_cliente')).toHaveLength(2);
  });

  it('sums duration', () => {
    const reels = STANDARD_PRESETS.find((p) => p.id === 'reels-video')!;
    expect(presetDurationDays(reels)).toBe(10);
  });
});
