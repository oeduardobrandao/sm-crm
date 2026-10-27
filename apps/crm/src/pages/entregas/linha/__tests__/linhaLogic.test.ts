import { describe, expect, it } from 'vitest';
import {
  defaultNovaData,
  formatBreakdown,
  mensagemGuardItem,
  mesLabel,
  nomeFluxoPadrao,
  normalizeNome,
  periodoFromMes,
} from '../linhaLogic';

type It = { data: string | null; tipo: 'feed' | 'carrossel' | 'reels' | 'stories' };
const row = (data: string | null, tipo: It['tipo'] = 'reels'): It => ({ data, tipo });

describe('normalizeNome', () => {
  it('lowercases, strips accents and trims', () => {
    expect(normalizeNome('  Pílar ')).toBe('pilar');
    expect(normalizeNome('EDUCAÇÃO')).toBe('educacao');
  });
});

describe('defaultNovaData', () => {
  it('returns the day after the latest dated row', () => {
    expect(defaultNovaData([row('2026-11-05'), row('2026-11-18'), row(null)], '2026-11-01')).toBe(
      '2026-11-19',
    );
  });

  it('defaultNovaData returns null past month end', () => {
    expect(defaultNovaData([row('2026-11-30')], '2026-11-01')).toBeNull();
  });

  it('starts on the first day when no row has a date', () => {
    expect(defaultNovaData([], '2026-11-01')).toBe('2026-11-01');
    expect(defaultNovaData([row(null)], '2026-11-01')).toBe('2026-11-01');
  });

  it('rolls over short months and leap years correctly', () => {
    expect(defaultNovaData([row('2026-02-28')], '2026-02-01')).toBeNull();
    expect(defaultNovaData([row('2028-02-28')], '2028-02-01')).toBe('2028-02-29');
  });
});

describe('formatBreakdown', () => {
  it('counts per format in TIPO_ORDER and omits absent formats', () => {
    const out = formatBreakdown([
      row('2026-11-01', 'reels'),
      row('2026-11-02', 'feed'),
      row('2026-11-03', 'reels'),
      row(null, 'stories'),
    ]);
    expect(out).toEqual([
      { tipo: 'feed', n: 1 },
      { tipo: 'reels', n: 2 },
      { tipo: 'stories', n: 1 },
    ]);
  });
});

describe('mesLabel / periodoFromMes', () => {
  it('names the month in lower-case pt-BR', () => {
    expect(mesLabel('2026-11-01')).toBe('novembro');
    expect(mesLabel('2026-03-01')).toBe('março');
  });

  it('turns YYYY-MM into the first day', () => {
    expect(periodoFromMes('2026-11')).toBe('2026-11-01');
  });
});

describe('nomeFluxoPadrao', () => {
  it('names a single-format selection after the format', () => {
    const itens = Array.from({ length: 6 }, (_, i) => row(`2026-11-0${i + 1}`, 'reels'));
    expect(nomeFluxoPadrao(itens, '2026-11-01')).toBe('Reels de novembro');
  });

  it('falls back to "Linha de" for mixed formats', () => {
    expect(
      nomeFluxoPadrao([row('2026-11-01', 'reels'), row('2026-11-02', 'feed')], '2026-11-01'),
    ).toBe('Linha de novembro');
  });
});

describe('mensagemGuardItem', () => {
  const pg = (message: string) => ({ message, code: 'P0001' });

  it('maps the 100-row cap', () => {
    expect(mensagemGuardItem(pg('linha_item_limite'))).toBe(
      'A linha chegou ao limite de 100 posts. Exclua uma linha para criar outra.',
    );
  });

  it('has no copy for the retired out-of-month raise (dates are free)', () => {
    expect(mensagemGuardItem(pg('linha_item_data_fora_do_mes'))).toBeNull();
  });

  it('maps a converted row', () => {
    expect(mensagemGuardItem(pg('linha_item_convertido'))).toBe(
      'Esta linha já virou post. Atualize a página.',
    );
  });

  it('returns null for anything else', () => {
    expect(mensagemGuardItem(pg('boom'))).toBeNull();
    expect(mensagemGuardItem(new Error('linha_nao_encontrada'))).toBeNull();
    expect(mensagemGuardItem(null)).toBeNull();
  });
});
