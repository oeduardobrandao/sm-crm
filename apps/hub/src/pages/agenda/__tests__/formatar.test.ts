import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HubAgendaItem } from '../../../types';
import {
  agruparPorDia,
  compararInicio,
  diaLocal,
  formatarDiaTitulo,
  formatarSugestao,
  linkGoogleAgenda,
  paredeNoFuso,
  proximosEventos,
  quando,
  rotuloFuso,
  somarDias,
  sugestaoNoPassado,
  ultimoDiaLocal,
} from '../formatar';

function item(over: Partial<HubAgendaItem> = {}): HubAgendaItem {
  return {
    ocorrencia_id: 1,
    sequencia: 0,
    inicio: '2026-10-20T18:00:00+00:00',
    fim: '2026-10-20T19:00:00+00:00',
    dia_inteiro: false,
    data_inicio_local: '2026-10-20',
    data_fim_local: '2026-10-20',
    tz: 'America/Sao_Paulo',
    titulo: 'Gravação',
    descricao: null,
    local: null,
    link_reuniao: null,
    resposta: null,
    remarcacao: null,
    ...over,
  };
}

// The browser zone deliberately differs from the fixtures' tz: every helper
// must format in the item's tz, never through local Date getters.
const tzOriginal = process.env.TZ;
beforeEach(() => {
  process.env.TZ = 'Asia/Tokyo';
});
afterEach(() => {
  process.env.TZ = tzOriginal;
});

describe('paredeNoFuso', () => {
  it('returns the wall clock in the given tz, not the browser zone', () => {
    expect(paredeNoFuso('2026-10-20T18:00:00Z', 'America/Manaus')).toEqual({
      data: '2026-10-20',
      hora: '14:00',
    });
    expect(paredeNoFuso('2026-10-20T18:00:00Z', 'America/Sao_Paulo')).toEqual({
      data: '2026-10-20',
      hora: '15:00',
    });
  });

  it('crosses midnight in tz', () => {
    expect(paredeNoFuso('2026-10-21T02:30:00Z', 'America/Sao_Paulo')).toEqual({
      data: '2026-10-20',
      hora: '23:30',
    });
    expect(paredeNoFuso('2026-10-21T03:00:00Z', 'America/Sao_Paulo').hora).toBe('00:00');
  });
});

describe('day helpers', () => {
  it('somarDias crosses months', () => {
    expect(somarDias('2026-10-31', 1)).toBe('2026-11-01');
    expect(somarDias('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('diaLocal is the start day in tz for timed and the local date for all-day', () => {
    expect(diaLocal(item({ inicio: '2026-10-21T02:30:00Z', tz: 'America/Sao_Paulo' }))).toBe(
      '2026-10-20',
    );
    expect(
      diaLocal(item({ dia_inteiro: true, data_inicio_local: '2026-10-09', inicio: 'x' })),
    ).toBe('2026-10-09');
  });

  it('ultimoDiaLocal turns the exclusive all-day end into the last day', () => {
    const umDia = item({
      dia_inteiro: true,
      data_inicio_local: '2026-10-09',
      data_fim_local: '2026-10-10',
    });
    expect(ultimoDiaLocal(umDia)).toBe('2026-10-09');
    const tresDias = item({
      dia_inteiro: true,
      data_inicio_local: '2026-10-09',
      data_fim_local: '2026-10-12',
    });
    expect(ultimoDiaLocal(tresDias)).toBe('2026-10-11');
  });

  it('formats a date-only day without shifting it (UTC midnight trap)', () => {
    expect(formatarDiaTitulo('2026-10-09', 'pt-BR')).toBe('sexta-feira, 9 de outubro');
    expect(formatarDiaTitulo('2026-10-09', 'en-US')).toBe('Friday, October 9');
  });
});

describe('quando', () => {
  it('formats a timed occurrence in its own tz and labels a non-Brasília zone', () => {
    const q = quando(item({ tz: 'America/Manaus' }), 'pt-BR');
    expect(q.horaInicio).toBe('14:00');
    expect(q.horaFim).toBe('15:00');
    expect(q.dia).toBe('ter., 20 de out.');
    expect(q.diaFim).toBeNull();
    expect(q.fuso).toBe('America/Manaus');
  });

  it('has no zone label for America/Sao_Paulo', () => {
    const q = quando(item(), 'pt-BR');
    expect(q.horaInicio).toBe('15:00');
    expect(q.fuso).toBeNull();
    expect(rotuloFuso('America/Sao_Paulo')).toBeNull();
    expect(rotuloFuso('America/Porto_Velho')).toBe('America/Porto Velho');
  });

  it('marks a timed occurrence that ends on another local day', () => {
    const q = quando(
      item({ inicio: '2026-10-21T01:00:00Z', fim: '2026-10-21T05:00:00Z' }),
      'pt-BR',
    );
    expect(q.dia).toBe('ter., 20 de out.');
    expect(q.diaFim).toBe('qua., 21 de out.');
  });

  it('all-day: no times, multi-day range uses the inclusive last day', () => {
    const q = quando(
      item({ dia_inteiro: true, data_inicio_local: '2026-10-09', data_fim_local: '2026-10-11' }),
      'pt-BR',
    );
    expect(q.diaInteiro).toBe(true);
    expect(q.horaInicio).toBeNull();
    expect(q.dia).toBe('sex., 9 de out.');
    expect(q.diaFim).toBe('sáb., 10 de out.');
  });
});

describe('formatarSugestao', () => {
  it('shows the suggestion in the occurrence tz', () => {
    expect(
      formatarSugestao(
        '2026-10-22T18:00:00Z',
        { tz: 'America/Sao_Paulo', dia_inteiro: false },
        'pt-BR',
      ),
    ).toBe('qui., 22 de out., 15:00');
    expect(
      formatarSugestao(
        '2026-10-22T18:00:00Z',
        { tz: 'America/Manaus', dia_inteiro: false },
        'pt-BR',
      ),
    ).toBe('qui., 22 de out., 14:00 (America/Manaus)');
  });

  it('all-day suggestions show only the day', () => {
    expect(
      formatarSugestao(
        '2026-10-22T03:00:00Z',
        { tz: 'America/Sao_Paulo', dia_inteiro: true },
        'pt-BR',
      ),
    ).toBe('qui., 22 de out.');
  });
});

describe('agruparPorDia / compararInicio', () => {
  it('groups by local day in order', () => {
    const a = item({ ocorrencia_id: 1, inicio: '2026-10-20T12:00:00Z' });
    const b = item({ ocorrencia_id: 2, inicio: '2026-10-20T20:00:00Z' });
    const c = item({ ocorrencia_id: 3, inicio: '2026-10-21T12:00:00Z' });
    const grupos = agruparPorDia([c, b, a].sort(compararInicio));
    expect(grupos.map((g) => g.dia)).toEqual(['2026-10-20', '2026-10-21']);
    expect(grupos[0].itens.map((i) => i.ocorrencia_id)).toEqual([1, 2]);
  });

  it('ties on inicio break by id', () => {
    const a = item({ ocorrencia_id: 5 });
    const b = item({ ocorrencia_id: 4 });
    expect([a, b].sort(compararInicio).map((i) => i.ocorrencia_id)).toEqual([4, 5]);
  });
});

describe('sugestaoNoPassado', () => {
  const agora = new Date('2026-10-07T15:00:00Z'); // 12:00 in São Paulo, 11:00 in Manaus

  it('compares wall clock in the tz', () => {
    expect(sugestaoNoPassado('2026-10-06', '20:00', 'America/Sao_Paulo', agora)).toBe(true);
    expect(sugestaoNoPassado('2026-10-07', '11:30', 'America/Sao_Paulo', agora)).toBe(true);
    expect(sugestaoNoPassado('2026-10-07', '11:30', 'America/Manaus', agora)).toBe(false);
    expect(sugestaoNoPassado('2026-10-08', '08:00', 'America/Sao_Paulo', agora)).toBe(false);
  });

  it('an all-day suggestion for today is already past', () => {
    expect(sugestaoNoPassado('2026-10-07', null, 'America/Sao_Paulo', agora)).toBe(true);
    expect(sugestaoNoPassado('2026-10-08', null, 'America/Sao_Paulo', agora)).toBe(false);
  });
});

describe('linkGoogleAgenda', () => {
  it('timed: UTC instants, details with the meeting link, location and ctz', () => {
    const url = new URL(
      linkGoogleAgenda(
        item({
          titulo: 'Reunião & café',
          descricao: 'Pauta',
          local: 'Sala 2',
          link_reuniao: 'https://meet.example.com/x',
          tz: 'America/Manaus',
        }),
      ),
    );
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Reunião & café');
    expect(url.searchParams.get('dates')).toBe('20261020T180000Z/20261020T190000Z');
    expect(url.searchParams.get('details')).toBe(
      'Pauta\n\nLink da reunião: https://meet.example.com/x',
    );
    expect(url.searchParams.get('location')).toBe('Sala 2');
    expect(url.searchParams.get('ctz')).toBe('America/Manaus');
  });

  it('all-day: local dates with the exclusive end as-is, no empty params', () => {
    const url = new URL(
      linkGoogleAgenda(
        item({ dia_inteiro: true, data_inicio_local: '2026-10-09', data_fim_local: '2026-10-10' }),
      ),
    );
    expect(url.searchParams.get('dates')).toBe('20261009/20261010');
    expect(url.searchParams.has('details')).toBe(false);
    expect(url.searchParams.has('location')).toBe(false);
  });
});

describe('proximosEventos', () => {
  const agora = Date.parse('2026-10-20T18:30:00Z');
  it('drops what has ended, keeps what is under way, sorts by start then id', () => {
    const fim = item({ ocorrencia_id: 1, fim: '2026-10-20T18:30:00Z' }); // ended exactly now
    const emCurso = item({ ocorrencia_id: 2 }); // 18:00-19:00
    const depois = item({
      ocorrencia_id: 3,
      inicio: '2026-10-21T12:00:00Z',
      fim: '2026-10-21T13:00:00Z',
    });
    const mesmoInicio = item({ ocorrencia_id: 4, inicio: '2026-10-21T12:00:00Z', fim: depois.fim });
    const entrada = [mesmoInicio, depois, fim, emCurso];
    expect(proximosEventos(entrada, agora).map((i) => i.ocorrencia_id)).toEqual([2, 3, 4]);
    expect(entrada.map((i) => i.ocorrencia_id)).toEqual([4, 3, 1, 2]); // input untouched
  });
});
