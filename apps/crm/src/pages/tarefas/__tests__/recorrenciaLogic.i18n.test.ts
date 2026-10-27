import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import type { TarefaSerieRegra, TarefaSerieResumo } from '../../../store';
import {
  describeRecorrencia,
  modoLabel,
  REPETIR_LABELS,
  serieEstadoLabel,
  unidadeIntervalo,
  WEEKDAY_CHIPS,
  WEEKDAY_NAMES,
} from '../recorrenciaLogic';

const base: TarefaSerieRegra = {
  freq: 'daily',
  intervalo: 1,
  dias_semana: null,
  dia_mes: null,
  mes: null,
  modo: 'ao_concluir',
  fim: null,
};
const serie = (over: Partial<TarefaSerieResumo> = {}): TarefaSerieResumo => ({
  ...base,
  id: 1,
  inicio: '2026-01-05',
  pausada: false,
  encerrada_em: null,
  proxima_data: null,
  ...over,
});
const TODAY = new Date(2026, 0, 5);

describe('recorrenciaLogic in English', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    await i18n.changeLanguage('pt');
  });

  it('describes daily, weekly, monthly and yearly rules as whole sentences', () => {
    expect(describeRecorrencia(base)).toBe('Every day');
    expect(describeRecorrencia({ ...base, intervalo: 3 })).toBe('Every 3 days');
    expect(describeRecorrencia({ ...base, freq: 'weekly', dias_semana: [3, 1] })).toBe(
      'Every Monday and Wednesday',
    );
    expect(describeRecorrencia({ ...base, freq: 'weekly', dias_semana: [0, 1, 3] })).toBe(
      'Every Monday, Wednesday and Sunday',
    );
    expect(describeRecorrencia({ ...base, freq: 'weekly', intervalo: 2, dias_semana: [5] })).toBe(
      'Every 2 weeks on Friday',
    );
    expect(describeRecorrencia({ ...base, freq: 'monthly', dia_mes: 15 })).toBe(
      'Every month on day 15',
    );
    expect(describeRecorrencia({ ...base, freq: 'monthly', intervalo: 3, dia_mes: 31 })).toBe(
      'Every 3 months on day 31 (or the last day)',
    );
    expect(describeRecorrencia({ ...base, freq: 'yearly', dia_mes: 10, mes: 3 })).toBe(
      'Every year on March 10',
    );
    expect(
      describeRecorrencia({ ...base, freq: 'yearly', intervalo: 2, dia_mes: 10, mes: 3 }),
    ).toBe('Every 2 years on March 10');
    expect(describeRecorrencia({ ...base, fim: '2026-12-31' })).toBe('Every day until 12/31/2026');
  });

  it('translates the label exports at read time', () => {
    expect(REPETIR_LABELS.never).toBe('Does not repeat');
    expect(REPETIR_LABELS.weekly).toBe('Weekly');
    expect([...WEEKDAY_CHIPS]).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    expect(WEEKDAY_NAMES[1]).toBe('Monday');
    expect(unidadeIntervalo('monthly', 1)).toBe('month');
    expect(unidadeIntervalo('monthly', 2)).toBe('months');
    expect(modoLabel('ao_concluir')).toBe('creates the next one when completed');
    expect(modoLabel('calendario')).toBe('creates one on every date in the rule');
  });

  it('labels series states', () => {
    expect(serieEstadoLabel(serie(), TODAY)).toBeNull();
    expect(serieEstadoLabel(serie({ fim: '2026-12-31' }), TODAY)).toBe('Ends on 12/31/2026');
    expect(serieEstadoLabel(serie({ pausada: true }), TODAY)).toBe('Paused');
    expect(serieEstadoLabel(serie({ encerrada_em: 'x' }), TODAY)).toBe('Ended');
    expect(serieEstadoLabel(serie({ fim: '2026-01-04' }), TODAY)).toBe('Completed');
  });

  it('switches back to Portuguese without a reload', async () => {
    await i18n.changeLanguage('pt');
    expect(REPETIR_LABELS.never).toBe('Não repete');
    expect(WEEKDAY_NAMES[2]).toBe('terça');
    expect(unidadeIntervalo('daily', 0)).toBe('dias');
    expect(describeRecorrencia({ ...base, freq: 'weekly', dias_semana: [6, 0] })).toBe(
      'Todo sábado e domingo',
    );
  });
});
