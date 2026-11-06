import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import {
  contratoRotulo,
  dataCurta,
  modeloDescricao,
  modeloLabel,
  periodoLabel,
  rotuloValeDesde,
} from '../acordoHelpers';

afterEach(async () => {
  await i18n.changeLanguage('pt');
});

describe('acordoHelpers in Portuguese', () => {
  it('keeps the original strings', () => {
    expect(modeloLabel('mensal_meta')).toBe('Mensal com meta');
    expect(modeloDescricao('por_entrega')).toBe('Recebe por cada entrega feita.');
    expect(periodoLabel('dia_util')).toBe('dia útil');
    expect(rotuloValeDesde('2026-10-01')).toBe('out 2026');
    expect(rotuloValeDesde('2026-10-15')).toBe('15 out 2026');
    expect(dataCurta('2026-10-05')).toBe('05/10/2026');
    expect(contratoRotulo('conta/1/abc.PDF')).toBe('Contrato.pdf');
    expect(contratoRotulo('conta/1/abc')).toBe('Contrato');
  });
});

describe('acordoHelpers in English', () => {
  it('translates labels resolved at call time', async () => {
    await i18n.changeLanguage('en');
    expect(modeloLabel('mensal_meta')).toBe('Monthly with target');
    expect(modeloLabel('mensal_limite')).toBe('Monthly with limit');
    expect(modeloLabel('por_entrega')).toBe('Per deliverable');
    expect(modeloDescricao('mensal_meta')).toBe('Fixed monthly amount and a deliverables target.');
    expect(periodoLabel('dia_util')).toBe('business day');
    expect(periodoLabel('semana')).toBe('week');
    expect(periodoLabel('mes')).toBe('month');
  });

  it('formats dates in English', async () => {
    await i18n.changeLanguage('en');
    expect(rotuloValeDesde('2026-10-01')).toBe('Oct 2026');
    expect(rotuloValeDesde('2026-10-15')).toBe('Oct 15, 2026');
    expect(dataCurta('2026-10-05')).toBe('10/05/2026');
  });

  it('names the contract in English', async () => {
    await i18n.changeLanguage('en');
    expect(contratoRotulo('conta/1/abc.jpg')).toBe('Contract.jpg');
    expect(contratoRotulo('conta/1/abc')).toBe('Contract');
  });
});
