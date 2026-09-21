import { describe, expect, it } from 'vitest';
import type { TarefaSerieRegra, TarefaSerieResumo } from '../../../store';
import {
  describeRecorrencia,
  modoLabel,
  regraFromForm,
  regraIgual,
  serieEstado,
  serieEstadoLabel,
  unidadeIntervalo,
} from '../recorrenciaLogic';
import { tarefaFormSchema, BLANK_TAREFA_FORM } from '../components/tarefaFormSchema';

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

describe('describeRecorrencia', () => {
  it('daily', () => {
    expect(describeRecorrencia(base)).toBe('Todo dia');
    expect(describeRecorrencia({ ...base, intervalo: 3 })).toBe('A cada 3 dias');
  });
  it('weekly orders days Mon..Sun and uses "e" before the last', () => {
    expect(describeRecorrencia({ ...base, freq: 'weekly', dias_semana: [3, 1] })).toBe(
      'Toda segunda e quarta',
    );
    expect(describeRecorrencia({ ...base, freq: 'weekly', intervalo: 2, dias_semana: [5] })).toBe(
      'A cada 2 semanas, na sexta',
    );
    expect(describeRecorrencia({ ...base, freq: 'weekly', dias_semana: [0, 1, 3] })).toBe(
      'Toda segunda, quarta e domingo',
    );
  });
  it('monthly, with the last-day hint for days above 28', () => {
    expect(describeRecorrencia({ ...base, freq: 'monthly', dia_mes: 15 })).toBe('Todo dia 15');
    expect(describeRecorrencia({ ...base, freq: 'monthly', intervalo: 3, dia_mes: 31 })).toBe(
      'A cada 3 meses, no dia 31 (ou último dia)',
    );
  });
  it('yearly and the end suffix', () => {
    expect(describeRecorrencia({ ...base, freq: 'yearly', dia_mes: 10, mes: 3 })).toBe(
      'Todo ano em 10/03',
    );
    expect(
      describeRecorrencia({ ...base, freq: 'yearly', intervalo: 2, dia_mes: 10, mes: 3 }),
    ).toBe('A cada 2 anos, em 10/03');
    expect(describeRecorrencia({ ...base, fim: '2026-12-31' })).toBe('Todo dia até 31/12/2026');
  });
});

describe('labels and states', () => {
  it('unidadeIntervalo', () => {
    expect(unidadeIntervalo('daily', 1)).toBe('dia');
    expect(unidadeIntervalo('daily', 2)).toBe('dias');
    expect(unidadeIntervalo('monthly', 1)).toBe('mês');
    expect(unidadeIntervalo('monthly', 2)).toBe('meses');
  });
  it('modoLabel', () => {
    expect(modoLabel('ao_concluir')).toBe('cria a próxima ao concluir');
    expect(modoLabel('calendario')).toBe('cria em toda data da regra');
  });
  it('serieEstado follows the states table with precedence Encerrada > Concluída > Pausada > Ativa', () => {
    expect(serieEstado(serie(), TODAY)).toBe('ativa');
    expect(serieEstado(serie({ pausada: true }), TODAY)).toBe('pausada');
    // encerrada wins over everything
    expect(serieEstado(serie({ pausada: true, encerrada_em: '2026-01-01T00:00:00Z' }), TODAY)).toBe(
      'encerrada',
    );
    expect(
      serieEstado(serie({ fim: '2026-01-04', encerrada_em: '2026-01-01T00:00:00Z' }), TODAY),
    ).toBe('encerrada');
    // concluida wins over pausada
    expect(serieEstado(serie({ fim: '2026-01-04' }), TODAY)).toBe('concluida');
    expect(serieEstado(serie({ fim: '2026-01-04', pausada: true }), TODAY)).toBe('concluida');
    expect(
      serieEstado(serie({ modo: 'calendario', proxima_data: null, pausada: true }), TODAY),
    ).toBe('concluida');
    // fim today is still active; calendario with a cursor is active
    expect(serieEstado(serie({ fim: '2026-01-05' }), TODAY)).toBe('ativa');
    expect(serieEstado(serie({ modo: 'calendario', proxima_data: '2026-01-06' }), TODAY)).toBe(
      'ativa',
    );
    // ao_concluir never reads proxima_data
    expect(serieEstado(serie({ modo: 'ao_concluir', proxima_data: null }), TODAY)).toBe('ativa');
  });
  it('serieEstadoLabel', () => {
    expect(serieEstadoLabel(serie(), TODAY)).toBeNull();
    expect(serieEstadoLabel(serie({ fim: '2026-12-31' }), TODAY)).toBe('Termina em 31/12/2026');
    expect(serieEstadoLabel(serie({ pausada: true }), TODAY)).toBe('Pausada');
    expect(serieEstadoLabel(serie({ encerrada_em: 'x' }), TODAY)).toBe('Encerrada');
    expect(serieEstadoLabel(serie({ fim: '2026-01-04' }), TODAY)).toBe('Concluída');
  });
});

describe('regraFromForm / regraIgual', () => {
  const values = {
    ...BLANK_TAREFA_FORM,
    repetir: 'monthly' as const,
    intervalo: '2',
    dias_semana: [],
    fim: undefined,
    modo: 'calendario' as const,
  };
  it('returns null for "never"', () => {
    expect(regraFromForm({ ...values, repetir: 'never' }, new Date(2026, 0, 31), null)).toBeNull();
  });
  it('derives the landing day/month from the due date when landing is null (new series)', () => {
    expect(regraFromForm(values, new Date(2026, 0, 31), null)).toEqual({
      freq: 'monthly',
      intervalo: 2,
      dias_semana: null,
      dia_mes: 31,
      mes: null,
      modo: 'calendario',
      fim: null,
    });
    expect(
      regraFromForm({ ...values, repetir: 'yearly' }, new Date(2026, 2, 10), null),
    ).toMatchObject({ dia_mes: 10, mes: 3 });
  });
  it('keeps the series landing when editing (Prazo change does not move dia_mes)', () => {
    expect(regraFromForm(values, new Date(2026, 1, 28), { dia_mes: 31, mes: null })).toMatchObject({
      dia_mes: 31,
    });
  });
  it('weekly sorts the days and formats fim', () => {
    expect(
      regraFromForm(
        { ...values, repetir: 'weekly', dias_semana: [3, 1], fim: new Date(2026, 11, 31) },
        TODAY,
        null,
      ),
    ).toEqual({
      freq: 'weekly',
      intervalo: 2,
      dias_semana: [1, 3],
      dia_mes: null,
      mes: null,
      modo: 'calendario',
      fim: '2026-12-31',
    });
  });
  it('regraIgual ignores day order', () => {
    expect(
      regraIgual(
        { ...base, freq: 'weekly', dias_semana: [1, 3] },
        { ...base, freq: 'weekly', dias_semana: [3, 1] },
      ),
    ).toBe(true);
    expect(regraIgual(base, { ...base, intervalo: 2 })).toBe(false);
  });
});

describe('tarefaFormSchema', () => {
  const ok = { ...BLANK_TAREFA_FORM, titulo: 'x', data_limite: new Date(2099, 0, 1) };
  it('rule requires a due date', () => {
    const r = tarefaFormSchema.safeParse({ ...ok, data_limite: undefined, repetir: 'daily' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({
      path: ['data_limite'],
      message: 'Defina um prazo: ele será a primeira ocorrência.',
    });
  });
  it('a NEW series requires today or later', () => {
    const r = tarefaFormSchema.safeParse({
      ...ok,
      repetir: 'daily',
      serie_nova: true,
      data_limite: new Date(2000, 0, 1),
    });
    expect(r.error?.issues[0]).toMatchObject({
      path: ['data_limite'],
      message: 'Para repetir, o prazo precisa ser hoje ou depois.',
    });
    expect(
      tarefaFormSchema.safeParse({
        ...ok,
        repetir: 'daily',
        serie_nova: false,
        data_limite: new Date(2000, 0, 1),
      }).success,
    ).toBe(true);
  });
  it('weekly needs a day, intervalo 1..99, fim after the due date', () => {
    expect(
      tarefaFormSchema.safeParse({ ...ok, repetir: 'weekly', dias_semana: [] }).error?.issues[0],
    ).toMatchObject({ path: ['dias_semana'], message: 'Escolha ao menos um dia da semana.' });
    expect(
      tarefaFormSchema.safeParse({ ...ok, repetir: 'daily', intervalo: '0' }).error?.issues[0],
    ).toMatchObject({ path: ['intervalo'], message: 'Use um número de 1 a 99.' });
    expect(tarefaFormSchema.safeParse({ ...ok, repetir: 'daily', intervalo: '1.5' }).success).toBe(
      false,
    );
    expect(
      tarefaFormSchema.safeParse({ ...ok, repetir: 'daily', fim: new Date(2098, 0, 1) }).error
        ?.issues[0],
    ).toMatchObject({
      path: ['fim'],
      message: 'A data final precisa ser igual ou depois do prazo.',
    });
  });
  it('"never" ignores the rule fields', () => {
    expect(
      tarefaFormSchema.safeParse({ ...ok, repetir: 'never', intervalo: '0', dias_semana: [] })
        .success,
    ).toBe(true);
  });
});
