import { describe, expect, it } from 'vitest';
import { STANDARD_PRESETS, presetDurationDays } from '../presets';

describe('STANDARD_PRESETS', () => {
  it('has 6 presets with unique ids', () => {
    expect(STANDARD_PRESETS).toHaveLength(6);
    expect(new Set(STANDARD_PRESETS.map((p) => p.id)).size).toBe(6);
  });

  it('every preset has at least one named etapa and no responsavel', () => {
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
    const avulso = STANDARD_PRESETS.find((p) => p.id === 'post-avulso')!;
    expect(presetDurationDays(avulso)).toBe(4);
  });
});
