import { describe, it, expect } from 'vitest';
import type { AgendaOcorrencia, AgendaRegra } from '../../../../store/agenda';
import {
  HORARIOS,
  MAX_LEMBRETES,
  MAX_PARTICIPANTES,
  camposDeSerieAlterados,
  chavesAlteradas,
  duracaoRotulo,
  eventoFormSchema,
  montarPayload,
  montarPayloadEdicao,
  motivoSerie,
  normalizarRegra,
  opcoesMensaisPersonalizadas,
  personalizadaParaRegra,
  regraAcompanhouData,
  regraParaPersonalizada,
  rotuloDtstart,
  validarPersonalizada,
  valoresDeOcorrencia,
  valoresIniciaisCriar,
  type EventoFormValues,
} from '../eventoFormSchema';

// October 2026: the 5th is a Monday, the 7th a Wednesday, the 26th the last Monday.
const SEG_5 = new Date(2026, 9, 5);
const QUA_7 = new Date(2026, 9, 7);
const SEG_26 = new Date(2026, 9, 26);

function regra(p: Partial<AgendaRegra>): AgendaRegra {
  return {
    freq: 'weekly',
    intervalo: 1,
    dias_semana: null,
    mensal_modo: null,
    mensal_ordinal: null,
    ate: null,
    contagem: null,
    ...p,
  };
}

function valores(p: Partial<EventoFormValues> = {}): EventoFormValues {
  return {
    ...valoresIniciaisCriar({
      inicio: new Date(2026, 9, 5, 14, 0),
      fim: new Date(2026, 9, 5, 16, 0),
      diaInteiro: false,
    }),
    titulo: 'Gravação',
    ...p,
  };
}

function ocorrencia(p: Partial<AgendaOcorrencia> = {}): AgendaOcorrencia {
  return {
    ocorrencia_id: 7,
    evento_id: 3,
    data_original: '2026-10-05',
    // 14:00 to 16:00 in São Paulo (UTC-3).
    inicio: '2026-10-05T17:00:00+00:00',
    fim: '2026-10-05T19:00:00+00:00',
    dia_inteiro: false,
    data_inicio_local: '2026-10-05',
    data_fim_local: '2026-10-06',
    titulo: 'Gravação: Clínica Sorriso',
    descricao: null,
    local: 'Estúdio 2',
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
      { user_id: 'u1', resposta: 'pendente' },
    ],
    minha_resposta: 'sim',
    pode_editar: true,
    pode_responder: false,
    tz: 'America/Sao_Paulo',
    compartilhado_cliente: false,
    cliente_resposta: null,
    remarcacao_pendente: null,
    sequencia: 0,
    ...p,
  };
}

function erros(v: EventoFormValues): Record<string, string> {
  const r = eventoFormSchema.safeParse(v);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

describe('eventoFormSchema', () => {
  it('accepts a valid timed event', () => {
    expect(erros(valores())).toEqual({});
  });

  it('requires a title', () => {
    expect(erros(valores({ titulo: '   ' }))).toEqual({ titulo: 'Informe um título.' });
  });

  it('requires the end after the start', () => {
    expect(erros(valores({ hora_fim: '14:00' }))).toEqual({
      hora_fim: 'O fim precisa ser depois do início.',
    });
    expect(erros(valores({ hora_fim: '13:45' }))).toEqual({
      hora_fim: 'O fim precisa ser depois do início.',
    });
    // An end on the next day is fine even with an earlier clock time.
    expect(erros(valores({ hora_fim: '01:00', data_fim: new Date(2026, 9, 6) }))).toEqual({});
  });

  it('lets an all-day event end on its start day but not before', () => {
    expect(erros(valores({ dia_inteiro: true, data_fim: SEG_5 }))).toEqual({});
    expect(erros(valores({ dia_inteiro: true, data_fim: new Date(2026, 9, 4) }))).toEqual({
      data_fim: 'O fim precisa ser depois do início.',
    });
  });

  it('requires an http(s) link', () => {
    const msg = 'Informe um link que comece com http:// ou https://.';
    expect(erros(valores({ link_reuniao: 'meet.google.com/abc' }))).toEqual({
      link_reuniao: msg,
    });
    expect(erros(valores({ link_reuniao: 'javascript:alert(1)' }))).toEqual({ link_reuniao: msg });
    expect(erros(valores({ link_reuniao: 'https://meet.google.com/abc' }))).toEqual({});
    expect(erros(valores({ link_reuniao: '' }))).toEqual({});
  });

  it('caps text lengths like the database CHECKs', () => {
    expect(erros(valores({ titulo: 'a'.repeat(200) }))).toEqual({});
    expect(erros(valores({ titulo: 'a'.repeat(201) }))).toEqual({
      titulo: 'Use no máximo 200 caracteres.',
    });
    expect(erros(valores({ descricao: 'a'.repeat(5000) }))).toEqual({});
    expect(erros(valores({ descricao: 'a'.repeat(5001) }))).toEqual({
      descricao: 'Use no máximo 5000 caracteres.',
    });
    expect(erros(valores({ local: 'a'.repeat(300) }))).toEqual({});
    expect(erros(valores({ local: 'a'.repeat(301) }))).toEqual({
      local: 'Use no máximo 300 caracteres.',
    });
  });

  it('caps the duration: 14 days with times, 31 days all-day', () => {
    // 14 days exactly is allowed; one quarter-hour more is not.
    expect(erros(valores({ data_fim: new Date(2026, 9, 19), hora_fim: '14:00' }))).toEqual({});
    expect(erros(valores({ data_fim: new Date(2026, 9, 19), hora_fim: '14:15' }))).toEqual({
      hora_fim: 'O evento pode durar no máximo 14 dias.',
    });
    // Oct 5 to Nov 4 is 31 days; to Nov 5 is 32.
    expect(erros(valores({ dia_inteiro: true, data_fim: new Date(2026, 10, 4) }))).toEqual({});
    expect(erros(valores({ dia_inteiro: true, data_fim: new Date(2026, 10, 5) }))).toEqual({
      data_fim: 'O evento pode durar no máximo 31 dias.',
    });
  });

  it('caps people and reminders', () => {
    const pessoas = Array.from({ length: MAX_PARTICIPANTES + 1 }, (_, i) => `u${i}`);
    expect(MAX_PARTICIPANTES).toBe(50);
    expect(MAX_LEMBRETES).toBe(5);
    expect(erros(valores({ participantes: pessoas.slice(0, 50) }))).toEqual({});
    expect(erros(valores({ participantes: pessoas }))).toEqual({
      participantes: 'Adicione no máximo 50 pessoas.',
    });
    expect(erros(valores({ lembretes: [0, 5, 10, 15, 30] }))).toEqual({});
    expect(erros(valores({ lembretes: [0, 5, 10, 15, 30, 60] }))).toEqual({
      lembretes: 'Use no máximo 5 lembretes.',
    });
  });
});

describe('HORARIOS and duracaoRotulo', () => {
  it('has 96 quarter-hour slots', () => {
    expect(HORARIOS).toHaveLength(96);
    expect(HORARIOS[0]).toBe('00:00');
    expect(HORARIOS[1]).toBe('00:15');
    expect(HORARIOS[95]).toBe('23:45');
  });

  it('labels durations', () => {
    expect(duracaoRotulo(15)).toBe('15 min');
    expect(duracaoRotulo(60)).toBe('1 h');
    expect(duracaoRotulo(90)).toBe('1 h 30 min');
    expect(duracaoRotulo(600)).toBe('10 h');
  });
});

describe('valoresIniciaisCriar', () => {
  it('splits a timed selection and defaults reminders to [10]', () => {
    const v = valoresIniciaisCriar({
      inicio: new Date(2026, 9, 5, 14, 0),
      fim: new Date(2026, 9, 5, 15, 30),
      diaInteiro: false,
    });
    expect(v).toMatchObject({
      hora_inicio: '14:00',
      hora_fim: '15:30',
      dia_inteiro: false,
      lembretes: [10],
      repetir: 'nao',
      regra: null,
      tipo: 'reuniao',
      cliente_id: 'none',
    });
    expect(v.data_inicio).toEqual(SEG_5);
    expect(v.data_fim).toEqual(SEG_5);
  });

  it('turns the exclusive all-day end into the last day and has no reminders', () => {
    const v = valoresIniciaisCriar({
      inicio: SEG_5,
      fim: new Date(2026, 9, 7),
      diaInteiro: true,
    });
    expect(v.dia_inteiro).toBe(true);
    expect(v.data_fim).toEqual(new Date(2026, 9, 6));
    expect(v.lembretes).toEqual([]);
  });
});

describe('montarPayload', () => {
  it('builds a timed payload with local wall clocks', () => {
    const p = montarPayload(
      valores({
        descricao: '  ',
        local: ' Estúdio 2 ',
        cliente_id: '12',
        lembretes: [1440, 10],
      }),
    );
    expect(p).toEqual({
      titulo: 'Gravação',
      descricao: null,
      local: 'Estúdio 2',
      link_reuniao: null,
      tipo: 'reuniao',
      cor: null,
      cliente_id: 12,
      privado: false,
      compartilhado_cliente: false,
      dia_inteiro: false,
      inicio_local: '2026-10-05T14:00:00',
      fim_local: '2026-10-05T16:00:00',
      lembretes: [10, 1440],
      regra: null,
    });
    expect('tz' in p).toBe(false);
  });

  it('shares with the cliente only with a cliente and a non-private event', () => {
    const compartilha = (p: Partial<EventoFormValues>) =>
      montarPayload(valores({ compartilhado_cliente: true, ...p })).compartilhado_cliente;
    expect(compartilha({ cliente_id: '12' })).toBe(true);
    expect(compartilha({ cliente_id: 'none' })).toBe(false);
    expect(compartilha({ cliente_id: '12', privado: true })).toBe(false);
    expect(montarPayload(valores({ cliente_id: '12' })).compartilhado_cliente).toBe(false);
  });

  it('reads compartilhado_cliente back from the occurrence (never for a private one)', () => {
    expect(
      valoresDeOcorrencia(ocorrencia({ compartilhado_cliente: true })).compartilhado_cliente,
    ).toBe(true);
    expect(valoresDeOcorrencia(ocorrencia()).compartilhado_cliente).toBe(false);
    expect(
      valoresDeOcorrencia(ocorrencia({ compartilhado_cliente: true, privado: true }))
        .compartilhado_cliente,
    ).toBe(false);
  });

  it('sends the day after the last day at 00:00 for all-day events', () => {
    const p = montarPayload(
      valores({ dia_inteiro: true, data_fim: new Date(2026, 9, 6), lembretes: [] }),
    );
    expect(p.inicio_local).toBe('2026-10-05T00:00:00');
    expect(p.fim_local).toBe('2026-10-07T00:00:00');
  });

  it('sends regra null when it does not repeat', () => {
    const r = regra({ dias_semana: [1] });
    expect(montarPayload(valores({ repetir: 'semanal', regra: r })).regra).toEqual(r);
    expect(montarPayload(valores({ repetir: 'nao', regra: r })).regra).toBeNull();
  });
});

describe('valoresDeOcorrencia', () => {
  it('shows the times in the series tz and leaves the organizer out of the people', () => {
    const v = valoresDeOcorrencia(ocorrencia());
    expect(v).toMatchObject({
      titulo: 'Gravação: Clínica Sorriso',
      hora_inicio: '14:00',
      hora_fim: '16:00',
      cliente_id: '12',
      tipo: 'gravacao',
      local: 'Estúdio 2',
      descricao: '',
      participantes: ['u1'],
      lembretes: [10],
      repetir: 'nao',
    });
    expect(v.data_inicio).toEqual(SEG_5);
  });

  it('maps a stored rule to its Repetir option, normalising missing keys', () => {
    const v = valoresDeOcorrencia(
      ocorrencia({
        recorrente: true,
        regra: { freq: 'weekly', intervalo: 1, dias_semana: [1] } as AgendaRegra,
      }),
    );
    expect(v.repetir).toBe('semanal');
    expect(v.regra).toEqual(regra({ dias_semana: [1] }));
  });

  it('round-trips an all-day occurrence', () => {
    const o = ocorrencia({
      dia_inteiro: true,
      inicio: '2026-10-05T03:00:00+00:00',
      fim: '2026-10-07T03:00:00+00:00',
      data_fim_local: '2026-10-07',
      lembretes: [-540],
    });
    const v = valoresDeOcorrencia(o);
    expect(v.dia_inteiro).toBe(true);
    expect(v.data_fim).toEqual(new Date(2026, 9, 6));
    const p = montarPayload(v);
    expect(p.inicio_local).toBe('2026-10-05T00:00:00');
    expect(p.fim_local).toBe('2026-10-07T00:00:00');
  });
});

describe('normalizarRegra', () => {
  it('fills missing keys with null and keeps null', () => {
    expect(normalizarRegra(null)).toBeNull();
    expect(normalizarRegra({ freq: 'daily', intervalo: 2 } as AgendaRegra)).toEqual(
      regra({ freq: 'daily', intervalo: 2 }),
    );
  });
});

describe('regra <-> personalizada', () => {
  it('defaults to weekly on the start weekday', () => {
    expect(regraParaPersonalizada(null, QUA_7)).toEqual({
      freq: 'weekly',
      intervalo: '1',
      dias_semana: [3],
      mensal: 'mensal_dia',
      termina: 'nunca',
      ate: undefined,
      contagem: '13',
    });
  });

  it('round-trips a weekly rule with an end date', () => {
    const r = regra({ intervalo: 2, dias_semana: [1, 3], ate: '2026-11-30' });
    const s = regraParaPersonalizada(r, SEG_5);
    expect(s).toMatchObject({
      intervalo: '2',
      dias_semana: [1, 3],
      termina: 'em',
      ate: new Date(2026, 10, 30),
    });
    expect(personalizadaParaRegra(s, SEG_5)).toEqual(r);
  });

  it('round-trips a count', () => {
    const r = regra({ freq: 'daily', contagem: 5 });
    const s = regraParaPersonalizada(r, SEG_5);
    expect(s.termina).toBe('apos');
    expect(s.contagem).toBe('5');
    expect(personalizadaParaRegra(s, SEG_5)).toEqual(r);
  });

  it('derives the monthly ordinal from the start date', () => {
    const base = regraParaPersonalizada(null, SEG_26);
    expect(
      personalizadaParaRegra({ ...base, freq: 'monthly', mensal: 'mensal_ordinal' }, SEG_26),
    ).toEqual(regra({ freq: 'monthly', mensal_modo: 'dia_semana', mensal_ordinal: 4 }));
    expect(
      personalizadaParaRegra({ ...base, freq: 'monthly', mensal: 'mensal_ultima' }, SEG_26),
    ).toEqual(regra({ freq: 'monthly', mensal_modo: 'dia_semana', mensal_ordinal: -1 }));
    expect(
      personalizadaParaRegra({ ...base, freq: 'monthly', mensal: 'mensal_dia' }, SEG_26),
    ).toEqual(regra({ freq: 'monthly', mensal_modo: 'dia_mes' }));
    expect(
      regraParaPersonalizada(
        regra({ freq: 'monthly', mensal_modo: 'dia_semana', mensal_ordinal: -1 }),
        SEG_26,
      ).mensal,
    ).toBe('mensal_ultima');
  });

  it('lists the monthly modes that exist on the start date', () => {
    expect(opcoesMensaisPersonalizadas(SEG_5)).toEqual([
      { id: 'mensal_dia', label: 'No dia 5' },
      { id: 'mensal_ordinal', label: 'Na primeira segunda' },
    ]);
    expect(opcoesMensaisPersonalizadas(SEG_26).map((o) => o.label)).toEqual([
      'No dia 26',
      'Na quarta segunda',
      'Na última segunda',
    ]);
  });

  it('validates the custom dialog', () => {
    const s = regraParaPersonalizada(null, SEG_5);
    expect(validarPersonalizada(s, SEG_5)).toBeNull();
    expect(validarPersonalizada({ ...s, intervalo: '0' }, SEG_5)).toBe('Use um número de 1 a 99.');
    expect(validarPersonalizada({ ...s, dias_semana: [] }, SEG_5)).toBe(
      'Escolha ao menos um dia da semana.',
    );
    expect(validarPersonalizada({ ...s, termina: 'em', ate: new Date(2026, 9, 4) }, SEG_5)).toBe(
      'A data final precisa ser igual ou depois do início.',
    );
    expect(validarPersonalizada({ ...s, termina: 'em', ate: undefined }, SEG_5)).toBe(
      'Escolha a data final.',
    );
    expect(validarPersonalizada({ ...s, termina: 'apos', contagem: '731' }, SEG_5)).toBe(
      'Use um número de 1 a 730.',
    );
  });
});

describe('edit payload', () => {
  const antes = montarPayload(valoresDeOcorrencia(ocorrencia()));
  const r1 = regra({ dias_semana: [1] });
  const SERIE = {
    regra: null,
    tipo: 'gravacao',
    cor: null,
    cliente_id: 12,
    privado: false,
    compartilhado_cliente: false,
    dia_inteiro: false,
    lembretes: [10],
  };
  const CONTEUDO = {
    titulo: 'Gravação: Clínica Sorriso',
    descricao: null,
    local: 'Estúdio 2',
    link_reuniao: null,
  };
  const HORARIO = { inicio_local: '2026-10-05T14:00:00', fim_local: '2026-10-05T16:30:00' };

  it('lists the changed keys, reminders as a set and the rule deep', () => {
    expect(chavesAlteradas(antes, { ...antes })).toEqual([]);
    expect(chavesAlteradas(antes, { ...antes, lembretes: [10] })).toEqual([]);
    const a = { ...antes, lembretes: [10, 1440], regra: r1 };
    expect(chavesAlteradas(a, { ...a, lembretes: [1440, 10], regra: { ...r1 } })).toEqual([]);
    expect(chavesAlteradas(antes, { ...antes, local: null, fim_local: HORARIO.fim_local })).toEqual(
      ['local', 'fim_local'],
    );
  });

  it('"todas" always carries the rule and the series fields, content only when changed', () => {
    expect(montarPayloadEdicao(antes, antes, { escopo: 'todas' })).toEqual(SERIE);
    expect(
      montarPayloadEdicao(antes, { ...antes, titulo: 'Novo', local: null }, { escopo: 'todas' }),
    ).toEqual({ ...SERIE, titulo: 'Novo', local: null });
    expect(montarPayloadEdicao(antes, antes, { escopo: 'seguintes' })).toEqual(SERIE);
  });

  it('sharing is a series field: it locks "Este evento", rides along with todas, never with esta', () => {
    const ligou = { ...antes, compartilhado_cliente: true };
    expect(chavesAlteradas(antes, ligou)).toEqual(['compartilhado_cliente']);
    expect(
      camposDeSerieAlterados(antes, ligou, {
        participantesMudaram: false,
        regraAcompanhouData: true,
      }),
    ).toEqual(['compartilhado_cliente']);
    expect(motivoSerie(['compartilhado_cliente'])).toBe(
      'Vale para toda a série: você mudou o compartilhamento com o cliente.',
    );
    expect(montarPayloadEdicao(antes, ligou, { escopo: 'todas' })).toEqual({
      ...SERIE,
      compartilhado_cliente: true,
    });
    expect('compartilhado_cliente' in montarPayloadEdicao(antes, ligou, { escopo: 'esta' })).toBe(
      false,
    );
  });

  it('"todas" from an occurrence with a title override keeps the override out', () => {
    const o = ocorrencia({ recorrente: true, regra: r1, titulo: 'Só nesta semana' });
    const a = montarPayload(valoresDeOcorrencia(o));
    const p = montarPayloadEdicao(a, { ...a, lembretes: [30] }, { escopo: 'todas' });
    expect(p).toEqual({ ...SERIE, regra: r1, lembretes: [30] });
    expect('titulo' in p).toBe(false);
  });

  it('times travel as a pair, and only when they changed', () => {
    const soFim = { ...antes, fim_local: HORARIO.fim_local };
    expect(montarPayloadEdicao(antes, soFim, { escopo: 'todas' })).toEqual({
      ...SERIE,
      ...HORARIO,
    });
    expect(montarPayloadEdicao(antes, soFim, { escopo: 'esta' })).toEqual({
      ...CONTEUDO,
      ...HORARIO,
    });
    const p = montarPayloadEdicao(antes, { ...antes, titulo: 'x' }, { escopo: 'todas' });
    expect('inicio_local' in p || 'fim_local' in p).toBe(false);
  });

  it('an all-day end-date change sends both time keys', () => {
    const o = ocorrencia({
      dia_inteiro: true,
      inicio: '2026-10-05T03:00:00+00:00',
      fim: '2026-10-06T03:00:00+00:00',
      lembretes: [],
    });
    const v = valoresDeOcorrencia(o);
    const a = montarPayload(v);
    const d = montarPayload({ ...v, data_fim: new Date(2026, 9, 6) });
    expect(montarPayloadEdicao(a, d, { escopo: 'todas' })).toMatchObject({
      inicio_local: '2026-10-05T00:00:00',
      fim_local: '2026-10-07T00:00:00',
    });
  });

  it('a dia_inteiro change sends both time keys', () => {
    const d = montarPayload({ ...valoresDeOcorrencia(ocorrencia()), dia_inteiro: true });
    expect(montarPayloadEdicao(antes, d, { escopo: 'todas' })).toMatchObject({
      dia_inteiro: true,
      inicio_local: '2026-10-05T00:00:00',
      fim_local: '2026-10-06T00:00:00',
    });
  });

  it('"esta" always sends the four content keys and never series fields or tz', () => {
    const a = { ...antes, regra: r1 };
    const d = {
      ...a,
      regra: regra({ dias_semana: [3] }),
      inicio_local: '2026-10-07T14:00:00',
      fim_local: '2026-10-07T16:00:00',
      tz: 'UTC',
    } as typeof a;
    expect(montarPayloadEdicao(a, d, { escopo: 'esta' })).toEqual({
      ...CONTEUDO,
      inicio_local: '2026-10-07T14:00:00',
      fim_local: '2026-10-07T16:00:00',
    });
    expect(montarPayloadEdicao(a, d, { escopo: 'todas' })).toEqual({
      ...SERIE,
      regra: regra({ dias_semana: [3] }),
      inicio_local: '2026-10-07T14:00:00',
      fim_local: '2026-10-07T16:00:00',
    });
  });

  it('knows when the rule only followed the date', () => {
    expect(regraAcompanhouData('semanal', r1, QUA_7, regra({ dias_semana: [3] }))).toBe(true);
    expect(regraAcompanhouData('semanal', r1, QUA_7, regra({ freq: 'daily' }))).toBe(false);
    expect(regraAcompanhouData('nao', null, QUA_7, null)).toBe(true);
  });
});

describe('series fields', () => {
  const antes = montarPayload(valoresDeOcorrencia(ocorrencia()));
  const sem = { participantesMudaram: false, regraAcompanhouData: false };

  it('lists the series fields that changed', () => {
    expect(camposDeSerieAlterados(antes, { ...antes, titulo: 'x' }, sem)).toEqual([]);
    expect(camposDeSerieAlterados(antes, { ...antes, lembretes: [30] }, sem)).toEqual([
      'lembretes',
    ]);
    expect(camposDeSerieAlterados(antes, antes, { ...sem, participantesMudaram: true })).toEqual([
      'participantes',
    ]);
    const r = regra({ dias_semana: [3] });
    expect(camposDeSerieAlterados(antes, { ...antes, regra: r }, sem)).toEqual(['regra']);
    expect(
      camposDeSerieAlterados(antes, { ...antes, regra: r }, { ...sem, regraAcompanhouData: true }),
    ).toEqual([]);
  });

  it('explains why "Este evento" is off', () => {
    expect(motivoSerie([])).toBeNull();
    expect(motivoSerie(['regra'])).toBe('Vale para toda a série: você mudou a repetição.');
    expect(motivoSerie(['lembretes'])).toBe('Vale para toda a série: você mudou os lembretes.');
    expect(motivoSerie(['lembretes', 'tipo'])).toBe('Vale para toda a série.');
  });
});

describe('rotuloDtstart', () => {
  it('formats the normalised series start', () => {
    expect(rotuloDtstart('2026-10-06T14:00:00')).toBe('terça, 6 de outubro');
    expect(rotuloDtstart('2026-10-05 00:00:00')).toBe('segunda, 5 de outubro');
  });
});
