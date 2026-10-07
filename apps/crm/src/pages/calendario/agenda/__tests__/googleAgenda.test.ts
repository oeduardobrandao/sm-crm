import { describe, expect, it } from 'vitest';
import type { AgendaOcorrencia } from '../../../../store/agenda';
import { linkGoogleAgenda } from '../googleAgenda';

function oc(over: Partial<AgendaOcorrencia> = {}): AgendaOcorrencia {
  return {
    ocorrencia_id: 7,
    evento_id: 3,
    data_original: '2026-10-07',
    inicio: '2026-10-07T13:00:00+00:00',
    fim: '2026-10-07T14:00:00+00:00',
    dia_inteiro: false,
    data_inicio_local: '2026-10-07',
    data_fim_local: '2026-10-08',
    titulo: 'Reunião de pauta',
    descricao: null,
    local: null,
    link_reuniao: null,
    tipo: 'reuniao',
    cor: null,
    cliente_id: null,
    cliente_nome: null,
    privado: false,
    mascarado: false,
    recorrente: false,
    regra: null,
    lembretes: [10],
    organizador_id: 'u-me',
    participantes: [],
    minha_resposta: null,
    pode_editar: true,
    pode_responder: false,
    tz: 'America/Sao_Paulo',
    ...over,
  };
}

const params = (o: AgendaOcorrencia) => new URL(linkGoogleAgenda(o)).searchParams;

describe('linkGoogleAgenda', () => {
  it('points at the Google Calendar template endpoint', () => {
    const url = new URL(linkGoogleAgenda(oc()));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
  });

  it('writes a timed event as UTC instants', () => {
    const link = linkGoogleAgenda(oc());
    expect(link).toContain('dates=20261007T130000Z%2F20261007T140000Z');
    expect(params(oc()).get('text')).toBe('Reunião de pauta');
    expect(params(oc()).get('ctz')).toBe('America/Sao_Paulo');
  });

  it('normalises an offset instant to UTC', () => {
    const p = params(oc({ inicio: '2026-10-07T10:00:00-03:00', fim: '2026-10-07T11:30:00-03:00' }));
    expect(p.get('dates')).toBe('20261007T130000Z/20261007T143000Z');
  });

  it('writes an all-day event as dates with an exclusive end', () => {
    const p = params(
      oc({ dia_inteiro: true, data_inicio_local: '2026-10-07', data_fim_local: '2026-10-09' }),
    );
    expect(p.get('dates')).toBe('20261007/20261009');
  });

  it('keeps ampersands, hashes and accents through a round trip', () => {
    const p = params(
      oc({
        titulo: 'Q&A #1: Açaí & Café',
        local: 'Av. Paulista, 900 #12 & fundos',
        descricao: 'Pauta: ação + reação',
      }),
    );
    expect(p.get('text')).toBe('Q&A #1: Açaí & Café');
    expect(p.get('location')).toBe('Av. Paulista, 900 #12 & fundos');
    expect(p.get('details')).toBe('Pauta: ação + reação');
  });

  it('joins the description and the meeting link', () => {
    const p = params(
      oc({ descricao: '  Revisar a pauta  ', link_reuniao: 'https://meet.example/x' }),
    );
    expect(p.get('details')).toBe('Revisar a pauta\n\nLink da reunião: https://meet.example/x');
  });

  it('puts only the meeting link in details when there is no description', () => {
    const p = params(oc({ link_reuniao: 'https://meet.example/x' }));
    expect(p.get('details')).toBe('Link da reunião: https://meet.example/x');
  });

  it('omits details, location and ctz when there is nothing to say', () => {
    const p = params(oc({ descricao: '   ', local: null, link_reuniao: null, tz: '' }));
    expect(p.has('details')).toBe(false);
    expect(p.has('location')).toBe(false);
    expect(p.has('ctz')).toBe(false);
  });
});
