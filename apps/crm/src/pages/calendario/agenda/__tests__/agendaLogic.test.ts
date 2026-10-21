import { describe, it, expect } from 'vitest';
import type { AgendaEventoPayload, AgendaOcorrencia, AgendaRegra } from '../../../../store/agenda';
import {
  COR_HEX,
  LEMBRETES_DIA_INTEIRO,
  LEMBRETES_HORARIO,
  TIPO_COR,
  TIPO_LABEL,
  camposDeSerieMudaram,
  corDoEvento,
  deFuso,
  descreverRegra,
  ehUltimaSemanaDoMes,
  emFuso,
  filtrarPorPessoas,
  fusoDoNavegador,
  localIso,
  opcaoDaRegra,
  opcoesRepetir,
  ordinalDoDia,
  paredeNoFuso,
  rederivarRegra,
  rotuloLembrete,
  toEventInput,
} from '../agendaLogic';

// October 2026: the 5th is a Monday, the 1st a Thursday, the 31st a Saturday.
const SEG_5 = new Date(2026, 9, 5, 14, 0, 0);
const QUA_7 = new Date(2026, 9, 7, 14, 0, 0);
const TER_13 = new Date(2026, 9, 13, 9, 0, 0);
const SEG_26 = new Date(2026, 9, 26, 14, 0, 0);
const SEX_30 = new Date(2026, 9, 30, 14, 0, 0);
const SAB_31 = new Date(2026, 9, 31, 14, 0, 0);
const SAB_3 = new Date(2026, 9, 3, 14, 0, 0);

function regra(p: Partial<AgendaRegra>): AgendaRegra {
  return {
    freq: 'daily',
    intervalo: 1,
    dias_semana: null,
    mensal_modo: null,
    mensal_ordinal: null,
    ate: null,
    contagem: null,
    ...p,
  };
}

function ocorrencia(p: Partial<AgendaOcorrencia> = {}): AgendaOcorrencia {
  return {
    ocorrencia_id: 42,
    evento_id: 7,
    data_original: '2026-10-05',
    inicio: '2026-10-05T17:00:00+00:00',
    fim: '2026-10-05T19:00:00+00:00',
    dia_inteiro: false,
    data_inicio_local: '2026-10-05',
    data_fim_local: '2026-10-06',
    titulo: 'Gravação: Clínica Sorriso',
    descricao: null,
    local: null,
    link_reuniao: null,
    tipo: 'gravacao',
    cor: null,
    cliente_id: 12,
    cliente_nome: 'Clínica Sorriso',
    privado: false,
    mascarado: false,
    recorrente: false,
    regra: null,
    lembretes: [10],
    organizador_id: 'org',
    participantes: [
      { user_id: 'org', resposta: 'sim' },
      { user_id: 'u2', resposta: 'pendente' },
    ],
    minha_resposta: 'sim',
    pode_editar: true,
    pode_responder: false,
    tz: 'America/Sao_Paulo',
    ...p,
  };
}

function payload(p: Partial<AgendaEventoPayload> = {}): AgendaEventoPayload {
  return {
    titulo: 'Reunião',
    descricao: null,
    local: null,
    link_reuniao: null,
    tipo: 'reuniao',
    cor: null,
    cliente_id: null,
    privado: false,
    dia_inteiro: false,
    inicio_local: '2026-10-05T14:00:00',
    fim_local: '2026-10-05T15:00:00',
    lembretes: [10, 1440],
    regra: regra({ freq: 'weekly', dias_semana: [1, 3] }),
    ...p,
  };
}

describe('labels and colours', () => {
  it('TIPO_LABEL and TIPO_COR', () => {
    expect(TIPO_LABEL).toEqual({
      reuniao: 'Reunião',
      gravacao: 'Gravação',
      captacao: 'Captação',
      apresentacao: 'Apresentação',
      interno: 'Interno',
      outro: 'Outro',
    });
    expect(TIPO_COR).toEqual({
      reuniao: '#3b82f6',
      gravacao: '#e1306c',
      captacao: '#f59e0b',
      apresentacao: '#8b5cf6',
      interno: '#64748b',
      outro: '#14b8a6',
    });
  });

  it('COR_HEX covers the 8 palette keys with hex values', () => {
    expect(Object.keys(COR_HEX).sort()).toEqual(
      ['amarelo', 'azul', 'cinza', 'laranja', 'rosa', 'roxo', 'teal', 'verde'].sort(),
    );
    for (const v of Object.values(COR_HEX)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('corDoEvento: cor overrides tipo, masked is grey', () => {
    expect(corDoEvento({ cor: null, tipo: 'gravacao', mascarado: false })).toBe('#e1306c');
    expect(corDoEvento({ cor: 'verde', tipo: 'gravacao', mascarado: false })).toBe(COR_HEX.verde);
    expect(corDoEvento({ cor: null, tipo: null, mascarado: true })).toBe(COR_HEX.cinza);
  });
});

describe('ordinalDoDia / ehUltimaSemanaDoMes', () => {
  it('computes the ordinal of the weekday in the month', () => {
    expect(ordinalDoDia(SEG_5)).toBe(1);
    expect(ordinalDoDia(TER_13)).toBe(2);
    expect(ordinalDoDia(SEG_26)).toBe(4);
    expect(ordinalDoDia(SAB_31)).toBe(5);
  });

  it('detects the last week of the month', () => {
    expect(ehUltimaSemanaDoMes(SEG_5)).toBe(false);
    expect(ehUltimaSemanaDoMes(new Date(2026, 9, 24))).toBe(false);
    expect(ehUltimaSemanaDoMes(new Date(2026, 9, 25))).toBe(true);
    expect(ehUltimaSemanaDoMes(SEG_26)).toBe(true);
    expect(ehUltimaSemanaDoMes(new Date(2026, 1, 22))).toBe(true); // Feb 2026 has 28 days
    expect(ehUltimaSemanaDoMes(new Date(2026, 1, 21))).toBe(false);
  });
});

describe('opcoesRepetir', () => {
  it('lists the presets for Monday 5 October (no "última" option)', () => {
    expect(opcoesRepetir(new Date(2026, 9, 5)).map((o) => o.label)).toEqual([
      'Não se repete',
      'Todos os dias',
      'Semanal: cada segunda',
      'Mensal: no dia 5',
      'Mensal: na primeira segunda',
      'Anual: em 5 de outubro',
      'Todos os dias úteis (segunda a sexta)',
      'Personalizar…',
    ]);
  });

  it('adds "última" in the last week, keeping the ordinal one', () => {
    const labels = opcoesRepetir(new Date(2026, 9, 26)).map((o) => o.label);
    expect(labels).toContain('Mensal: na quarta segunda');
    expect(labels).toContain('Mensal: na última segunda');
    expect(labels.indexOf('Mensal: na última segunda')).toBe(
      labels.indexOf('Mensal: na quarta segunda') + 1,
    );
  });

  it('on day 31 drops the 5th-weekday option and keeps only "último"', () => {
    const ops = opcoesRepetir(SAB_31);
    const ids = ops.map((o) => o.id);
    expect(ids).not.toContain('mensal_ordinal');
    expect(ops.map((o) => o.label)).toContain('Mensal: no último sábado');
    expect(ops.map((o) => o.label)).toContain('Mensal: no dia 31');
    expect(ops.find((o) => o.id === 'mensal_ultima')?.regra?.mensal_ordinal).toBe(-1);
  });

  it('uses masculine articles for sábado and domingo', () => {
    const labels = opcoesRepetir(SAB_3).map((o) => o.label);
    expect(labels).toContain('Semanal: cada sábado');
    expect(labels).toContain('Mensal: no primeiro sábado');
  });

  it('builds the rules each preset stands for', () => {
    const byId = Object.fromEntries(opcoesRepetir(SEG_5).map((o) => [o.id, o.regra]));
    expect(byId.nao).toBeNull();
    expect(byId.personalizado).toBeNull();
    expect(byId.diario).toEqual(regra({ freq: 'daily' }));
    expect(byId.semanal).toEqual(regra({ freq: 'weekly', dias_semana: [1] }));
    expect(byId.mensal_dia).toEqual(regra({ freq: 'monthly', mensal_modo: 'dia_mes' }));
    expect(byId.mensal_ordinal).toEqual(
      regra({ freq: 'monthly', mensal_modo: 'dia_semana', mensal_ordinal: 1 }),
    );
    expect(byId.anual).toEqual(regra({ freq: 'yearly' }));
    expect(byId.dias_uteis).toEqual(regra({ freq: 'weekly', dias_semana: [1, 2, 3, 4, 5] }));
  });
});

describe('opcaoDaRegra', () => {
  it('maps each preset rule back to its id', () => {
    for (const d of [SEG_5, SEG_26, SAB_31]) {
      for (const o of opcoesRepetir(d)) {
        if (o.id === 'personalizado') continue;
        expect(opcaoDaRegra(o.regra, d)).toBe(o.id);
      }
    }
  });

  it('anything off-preset is personalizado', () => {
    expect(opcaoDaRegra(regra({ freq: 'daily', intervalo: 2 }), SEG_5)).toBe('personalizado');
    expect(opcaoDaRegra(regra({ freq: 'daily', ate: '2026-11-30' }), SEG_5)).toBe('personalizado');
    expect(opcaoDaRegra(regra({ freq: 'daily', contagem: 3 }), SEG_5)).toBe('personalizado');
    expect(opcaoDaRegra(regra({ freq: 'weekly', dias_semana: [3] }), SEG_5)).toBe('personalizado');
    expect(opcaoDaRegra(regra({ freq: 'weekly', dias_semana: [5, 4, 3, 2, 1] }), SEG_5)).toBe(
      'dias_uteis',
    );
  });
});

describe('rederivarRegra', () => {
  it('presets follow the new start date', () => {
    expect(rederivarRegra('semanal', regra({ freq: 'weekly', dias_semana: [1] }), QUA_7)).toEqual(
      regra({ freq: 'weekly', dias_semana: [3] }),
    );
    expect(rederivarRegra('mensal_ordinal', null, TER_13)).toEqual(
      regra({ freq: 'monthly', mensal_modo: 'dia_semana', mensal_ordinal: 2 }),
    );
    expect(rederivarRegra('nao', regra({}), QUA_7)).toBeNull();
  });

  it('personalizado keeps the current rule', () => {
    const atual = regra({ freq: 'weekly', intervalo: 2, dias_semana: [1, 3], contagem: 5 });
    expect(rederivarRegra('personalizado', atual, QUA_7)).toBe(atual);
  });

  it('falls back to the sibling monthly preset when the chosen one does not fit', () => {
    // "última" on a date outside the last week -> ordinal of the new date
    expect(rederivarRegra('mensal_ultima', null, SEG_5)).toEqual(
      regra({ freq: 'monthly', mensal_modo: 'dia_semana', mensal_ordinal: 1 }),
    );
    // ordinal on a 5th weekday -> "última"
    expect(rederivarRegra('mensal_ordinal', null, SAB_31)).toEqual(
      regra({ freq: 'monthly', mensal_modo: 'dia_semana', mensal_ordinal: -1 }),
    );
  });
});

describe('descreverRegra', () => {
  it('daily', () => {
    expect(descreverRegra(regra({ freq: 'daily' }), SEG_5)).toBe('Todos os dias');
    expect(descreverRegra(regra({ freq: 'daily', intervalo: 3 }), SEG_5)).toBe('A cada 3 dias');
  });

  it('weekly with interval, two days and an end date', () => {
    expect(
      descreverRegra(
        regra({ freq: 'weekly', intervalo: 2, dias_semana: [3, 1], ate: '2026-11-30' }),
        SEG_5,
      ),
    ).toBe('A cada 2 semanas na segunda e na quarta, até 30 de novembro de 2026');
  });

  it('weekly variants', () => {
    expect(descreverRegra(regra({ freq: 'weekly', dias_semana: [1] }), SEG_5)).toBe(
      'Semanalmente na segunda',
    );
    expect(descreverRegra(regra({ freq: 'weekly', dias_semana: [0, 6, 5] }), SEG_5)).toBe(
      'Semanalmente na sexta, no sábado e no domingo',
    );
    expect(descreverRegra(regra({ freq: 'weekly', dias_semana: [1, 2, 3, 4, 5] }), SEG_5)).toBe(
      'Todos os dias úteis',
    );
  });

  it('monthly by day and by weekday ordinal', () => {
    expect(descreverRegra(regra({ freq: 'monthly', mensal_modo: 'dia_mes' }), SEG_5)).toBe(
      'Mensalmente no dia 5',
    );
    expect(
      descreverRegra(regra({ freq: 'monthly', intervalo: 3, mensal_modo: 'dia_mes' }), SEG_5),
    ).toBe('A cada 3 meses no dia 5');
    expect(
      descreverRegra(
        regra({ freq: 'monthly', mensal_modo: 'dia_semana', mensal_ordinal: 2 }),
        TER_13,
      ),
    ).toBe('Mensalmente na segunda terça');
    expect(
      descreverRegra(
        regra({ freq: 'monthly', mensal_modo: 'dia_semana', mensal_ordinal: -1 }),
        SEX_30,
      ),
    ).toBe('Mensalmente na última sexta');
    expect(
      descreverRegra(
        regra({ freq: 'monthly', intervalo: 2, mensal_modo: 'dia_semana', mensal_ordinal: 1 }),
        SAB_3,
      ),
    ).toBe('A cada 2 meses no primeiro sábado');
  });

  it('yearly', () => {
    expect(descreverRegra(regra({ freq: 'yearly' }), SEG_5)).toBe('Anualmente em 5 de outubro');
    expect(descreverRegra(regra({ freq: 'yearly', intervalo: 2 }), SEG_5)).toBe(
      'A cada 2 anos em 5 de outubro',
    );
  });

  it('count endings', () => {
    expect(descreverRegra(regra({ freq: 'daily', contagem: 13 }), SEG_5)).toBe(
      'Todos os dias, 13 vezes',
    );
    expect(descreverRegra(regra({ freq: 'daily', contagem: 1 }), SEG_5)).toBe(
      'Todos os dias, 1 vez',
    );
  });
});

describe('rotuloLembrete', () => {
  it('timed events', () => {
    const casos: [number, string][] = [
      [0, 'Na hora'],
      [1, '1 minuto antes'],
      [5, '5 minutos antes'],
      [10, '10 minutos antes'],
      [15, '15 minutos antes'],
      [30, '30 minutos antes'],
      [60, '1 hora antes'],
      [120, '2 horas antes'],
      [1440, '1 dia antes'],
      [2880, '2 dias antes'],
      [10080, '1 semana antes'],
    ];
    for (const [m, label] of casos) expect(rotuloLembrete(m, false)).toBe(label);
  });

  it('all-day events', () => {
    const casos: [number, string][] = [
      [-540, 'No dia às 9h'],
      [-570, 'No dia às 9h30'],
      [900, '1 dia antes às 9h'],
      [2340, '2 dias antes às 9h'],
      [9540, '1 semana antes às 9h'],
    ];
    for (const [m, label] of casos) expect(rotuloLembrete(m, true)).toBe(label);
  });

  it('every listed option has a label', () => {
    expect(LEMBRETES_HORARIO).toEqual([0, 5, 10, 15, 30, 60, 1440]);
    expect(LEMBRETES_DIA_INTEIRO).toEqual([-540, 900, 9540]);
    expect(LEMBRETES_HORARIO.map((m) => rotuloLembrete(m, false))).toEqual([
      'Na hora',
      '5 minutos antes',
      '10 minutos antes',
      '15 minutos antes',
      '30 minutos antes',
      '1 hora antes',
      '1 dia antes',
    ]);
  });
});

describe('toEventInput', () => {
  it('timed event uses the ISO instants', () => {
    const ev = toEventInput(ocorrencia(), 'org');
    expect(ev).toMatchObject({
      id: '42',
      title: 'Gravação: Clínica Sorriso',
      start: '2026-10-05T17:00:00+00:00',
      end: '2026-10-05T19:00:00+00:00',
      allDay: false,
      editable: true,
      borderColor: '#e1306c',
    });
    expect(ev.classNames).toContain('agenda-ev');
    expect(ev.extendedProps.ocorrencia.ocorrencia_id).toBe(42);
  });

  it('all-day event uses the local date strings', () => {
    const o = ocorrencia({
      dia_inteiro: true,
      inicio: '2026-10-05T03:00:00+00:00',
      fim: '2026-10-08T03:00:00+00:00',
      data_inicio_local: '2026-10-05',
      data_fim_local: '2026-10-08',
    });
    const ev = toEventInput(o, 'org');
    expect(ev.start).toBe('2026-10-05');
    expect(ev.end).toBe('2026-10-08');
    expect(ev.allDay).toBe(true);
  });

  it('masked event is not editable and gets the masked class', () => {
    const ev = toEventInput(
      ocorrencia({ mascarado: true, titulo: 'Ocupado', tipo: null, pode_editar: true }),
      'u9',
    );
    expect(ev.editable).toBe(false);
    expect(ev.classNames).toContain('agenda-ev--mascarado');
  });

  it('not editable without pode_editar', () => {
    expect(toEventInput(ocorrencia({ pode_editar: false }), 'u2').editable).toBe(false);
  });

  it('pending and declined responses get their classes', () => {
    expect(toEventInput(ocorrencia({ minha_resposta: 'pendente' }), 'u2').classNames).toContain(
      'agenda-ev--pendente',
    );
    expect(toEventInput(ocorrencia({ minha_resposta: 'nao' }), 'u2').classNames).toContain(
      'agenda-ev--recusado',
    );
    const sim = toEventInput(ocorrencia({ minha_resposta: 'sim' }), 'org').classNames;
    expect(sim).not.toContain('agenda-ev--pendente');
    expect(sim).not.toContain('agenda-ev--recusado');
  });
});

describe('filtrarPorPessoas', () => {
  const a = ocorrencia({ ocorrencia_id: 1, organizador_id: 'org', participantes: [] });
  const b = ocorrencia({
    ocorrencia_id: 2,
    organizador_id: 'x',
    mascarado: true,
    participantes: [
      { user_id: 'x', resposta: null },
      { user_id: 'u2', resposta: null },
    ],
  });
  const c = ocorrencia({ ocorrencia_id: 3, organizador_id: null, participantes: [] });

  it('null returns everything', () => {
    expect(filtrarPorPessoas([a, b, c], null)).toEqual([a, b, c]);
  });

  it('matches organizer or any participant, masked included', () => {
    expect(filtrarPorPessoas([a, b, c], ['u2']).map((o) => o.ocorrencia_id)).toEqual([2]);
    expect(filtrarPorPessoas([a, b, c], ['org', 'x']).map((o) => o.ocorrencia_id)).toEqual([1, 2]);
    expect(filtrarPorPessoas([a, b, c], [])).toEqual([]);
  });
});

describe('camposDeSerieMudaram', () => {
  it('true when a series field changes', () => {
    expect(camposDeSerieMudaram(payload(), payload({ lembretes: [10] }))).toBe(true);
    expect(camposDeSerieMudaram(payload(), payload({ tipo: 'gravacao' }))).toBe(true);
    expect(camposDeSerieMudaram(payload(), payload({ cor: 'roxo' }))).toBe(true);
    expect(camposDeSerieMudaram(payload(), payload({ cliente_id: 3 }))).toBe(true);
    expect(camposDeSerieMudaram(payload(), payload({ privado: true }))).toBe(true);
    expect(camposDeSerieMudaram(payload(), payload({ dia_inteiro: true }))).toBe(true);
    expect(
      camposDeSerieMudaram(
        payload(),
        payload({ regra: regra({ freq: 'weekly', dias_semana: [1, 3], contagem: 4 }) }),
      ),
    ).toBe(true);
    expect(camposDeSerieMudaram(payload(), payload({ regra: null }))).toBe(true);
  });

  it('false for content and time changes, and for equal rules in another order', () => {
    expect(camposDeSerieMudaram(payload(), payload({ titulo: 'Outro título' }))).toBe(false);
    expect(
      camposDeSerieMudaram(
        payload(),
        payload({
          descricao: 'x',
          local: 'Sala 2',
          link_reuniao: 'https://meet.example/abc',
          inicio_local: '2026-10-06T10:00:00',
          fim_local: '2026-10-06T11:00:00',
        }),
      ),
    ).toBe(false);
    expect(
      camposDeSerieMudaram(
        payload(),
        payload({
          lembretes: [1440, 10],
          regra: regra({ freq: 'weekly', dias_semana: [3, 1] }),
        }),
      ),
    ).toBe(false);
  });
});

describe('time zone helpers', () => {
  const INSTANTE = '2026-10-05T17:00:00Z';
  const runner = fusoDoNavegador();
  // A zone guaranteed to differ from the runner's, so a runner-local
  // implementation cannot pass by accident.
  const OUTRO = runner === 'Asia/Tokyo' ? 'Pacific/Honolulu' : 'Asia/Tokyo';
  const ESPERADO_OUTRO = OUTRO === 'Asia/Tokyo' ? '2026-10-06T02:00:00' : '2026-10-05T07:00:00';

  it('fusoDoNavegador returns an IANA zone', () => {
    expect(runner).toMatch(/\w/);
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: runner })).not.toThrow();
  });

  it('localIso formats the local fields without offset', () => {
    expect(localIso(new Date(2026, 9, 5, 14, 0, 0))).toBe('2026-10-05T14:00:00');
    expect(localIso(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02T03:04:05');
  });

  it('paredeNoFuso gives the wall clock in the target zone', () => {
    const d = new Date(INSTANTE);
    expect(paredeNoFuso(d, 'America/Sao_Paulo')).toBe('2026-10-05T14:00:00');
    expect(paredeNoFuso(d, OUTRO)).toBe(ESPERADO_OUTRO);
    expect(paredeNoFuso(d, 'Asia/Tokyo')).not.toBe(paredeNoFuso(d, 'America/Sao_Paulo'));
  });

  it('paredeNoFuso handles midnight (no "24") and DST in New York', () => {
    expect(paredeNoFuso(new Date('2026-10-05T03:00:00Z'), 'America/Sao_Paulo')).toBe(
      '2026-10-05T00:00:00',
    );
    expect(paredeNoFuso(new Date('2026-07-01T16:00:00Z'), 'America/New_York')).toBe(
      '2026-07-01T12:00:00',
    );
    expect(paredeNoFuso(new Date('2026-12-01T17:00:00Z'), 'America/New_York')).toBe(
      '2026-12-01T12:00:00',
    );
  });

  it('emFuso returns a Date whose local fields are the wall clock in tz', () => {
    const sp = emFuso(INSTANTE, 'America/Sao_Paulo');
    expect(sp.getHours()).toBe(14);
    expect(sp.getDate()).toBe(5);
    const outro = emFuso(INSTANTE, OUTRO);
    expect(localIso(outro)).toBe(ESPERADO_OUTRO);
    expect(emFuso(INSTANTE, 'Asia/Tokyo').getHours()).toBe(2);
    expect(emFuso(INSTANTE, 'Asia/Tokyo').getDate()).toBe(6);
  });

  it('deFuso(emFuso(x, tz), tz) round-trips to the wall clock in tz', () => {
    for (const tz of ['America/Sao_Paulo', 'Asia/Tokyo', 'America/New_York', OUTRO]) {
      expect(deFuso(emFuso(INSTANTE, tz), tz)).toBe(paredeNoFuso(new Date(INSTANTE), tz));
    }
    expect(deFuso(new Date(2026, 9, 5, 9, 30, 0), 'Asia/Tokyo')).toBe('2026-10-05T09:30:00');
  });
});
