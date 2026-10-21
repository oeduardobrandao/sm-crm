import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('../core', () => ({
  supabase: { rpc: mockRpc },
  getUserId: vi.fn(),
  getContaId: vi.fn(),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));

import {
  AGENDA_QUERY_KEY,
  criarEvento,
  editarEvento,
  ehAgendaNaoExiste,
  excluirEvento,
  formatAgendaError,
  getAgendaOcorrencia,
  listAgenda,
  resolverRemarcacao,
  responderEvento,
  type AgendaEventoPayload,
} from '../agenda';

const PAYLOAD: AgendaEventoPayload = {
  titulo: 'Gravação: Clínica Sorriso',
  descricao: null,
  local: null,
  link_reuniao: null,
  tipo: 'gravacao',
  cor: null,
  cliente_id: 12,
  privado: false,
  dia_inteiro: false,
  tz: 'America/Sao_Paulo',
  inicio_local: '2026-10-05T14:00:00',
  fim_local: '2026-10-05T16:00:00',
  lembretes: [10, 1440],
  regra: null,
};

describe('agenda store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the query key', () => {
    expect(AGENDA_QUERY_KEY).toBe('agenda-ocorrencias');
  });

  it('listAgenda calls agenda_listar with the ISO range only', async () => {
    const rows = [{ ocorrencia_id: 1 }];
    mockRpc.mockResolvedValue({ data: rows, error: null });
    const de = new Date('2026-09-28T03:00:00Z');
    const ate = new Date('2026-10-05T03:00:00Z');
    const out = await listAgenda(de, ate);
    expect(mockRpc).toHaveBeenCalledWith('agenda_listar', {
      p_de: de.toISOString(),
      p_ate: ate.toISOString(),
    });
    expect(out).toEqual(rows);
  });

  it('listAgenda returns [] when data is null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await listAgenda(new Date(), new Date())).toEqual([]);
  });

  it('listAgenda propagates errors', async () => {
    const err = { message: 'agenda: período inválido', code: 'P0001' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(listAgenda(new Date(), new Date())).rejects.toBe(err);
  });

  it('getAgendaOcorrencia passes only p_ocorrencia_id and returns the row', async () => {
    mockRpc.mockResolvedValue({ data: [{ ocorrencia_id: 42 }], error: null });
    const out = await getAgendaOcorrencia(42);
    expect(mockRpc).toHaveBeenCalledWith('agenda_listar', { p_ocorrencia_id: 42 });
    expect(out).toEqual({ ocorrencia_id: 42 });
  });

  it('getAgendaOcorrencia returns null on empty', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    expect(await getAgendaOcorrencia(7)).toBeNull();
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await getAgendaOcorrencia(7)).toBeNull();
  });

  it('getAgendaOcorrencia propagates errors', async () => {
    const err = { message: 'boom' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(getAgendaOcorrencia(7)).rejects.toBe(err);
  });

  it('criarEvento passes p_evento + p_participantes and returns data[0]', async () => {
    const row = { evento_id: 3, ocorrencia_id: 9, dtstart: '2026-10-05T14:00:00' };
    mockRpc.mockResolvedValue({ data: [row], error: null });
    const out = await criarEvento(PAYLOAD, ['u1', 'u2']);
    expect(mockRpc).toHaveBeenCalledWith('agenda_evento_criar', {
      p_evento: PAYLOAD,
      p_participantes: ['u1', 'u2'],
    });
    expect(out).toEqual(row);
  });

  it('criarEvento throws when the RPC returns no row', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(criarEvento(PAYLOAD, [])).rejects.toThrow();
  });

  it('criarEvento propagates errors', async () => {
    const err = { message: 'agenda: a repetição não gera nenhuma data' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(criarEvento(PAYLOAD, [])).rejects.toBe(err);
  });

  it('editarEvento passes escopo, partial payload and participants', async () => {
    mockRpc.mockResolvedValue({ data: 55, error: null });
    const partial = { inicio_local: '2026-10-06T10:00:00', fim_local: '2026-10-06T11:00:00' };
    const out = await editarEvento(9, 'seguintes', partial, ['u1']);
    expect(mockRpc).toHaveBeenCalledWith('agenda_evento_editar', {
      p_ocorrencia_id: 9,
      p_escopo: 'seguintes',
      p_evento: partial,
      p_participantes: ['u1'],
    });
    expect(out).toBe(55);
  });

  it('editarEvento sends p_participantes null when null', async () => {
    mockRpc.mockResolvedValue({ data: 9, error: null });
    await editarEvento(9, 'todas', { titulo: 'Oi' }, null);
    expect(mockRpc).toHaveBeenCalledWith('agenda_evento_editar', {
      p_ocorrencia_id: 9,
      p_escopo: 'todas',
      p_evento: { titulo: 'Oi' },
      p_participantes: null,
    });
  });

  it('editarEvento propagates errors', async () => {
    const err = { message: 'agenda: este evento não existe mais' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(editarEvento(9, 'esta', {}, null)).rejects.toBe(err);
  });

  it('excluirEvento calls agenda_evento_excluir', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await excluirEvento(9, 'esta');
    expect(mockRpc).toHaveBeenCalledWith('agenda_evento_excluir', {
      p_ocorrencia_id: 9,
      p_escopo: 'esta',
    });
  });

  it('excluirEvento propagates errors', async () => {
    const err = { message: 'x' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(excluirEvento(9, 'todas')).rejects.toBe(err);
  });

  it('responderEvento calls agenda_responder', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await responderEvento(9, 'talvez', 'todas');
    expect(mockRpc).toHaveBeenCalledWith('agenda_responder', {
      p_ocorrencia_id: 9,
      p_resposta: 'talvez',
      p_escopo: 'todas',
    });
  });

  it('responderEvento propagates errors', async () => {
    const err = { message: 'x' };
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(responderEvento(9, 'sim', 'esta')).rejects.toBe(err);
  });
});

describe('resolverRemarcacao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts: calls agenda_remarcacao_resolver with a null message', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await resolverRemarcacao(5, true);
    expect(mockRpc).toHaveBeenCalledWith('agenda_remarcacao_resolver', {
      p_remarcacao: 5,
      p_aceitar: true,
      p_mensagem: null,
    });
  });

  it('declines with a trimmed message, and blank becomes null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await resolverRemarcacao(5, false, '  Sexta não dá.  ');
    expect(mockRpc).toHaveBeenLastCalledWith('agenda_remarcacao_resolver', {
      p_remarcacao: 5,
      p_aceitar: false,
      p_mensagem: 'Sexta não dá.',
    });
    await resolverRemarcacao(5, false, '   ');
    expect(mockRpc).toHaveBeenLastCalledWith('agenda_remarcacao_resolver', {
      p_remarcacao: 5,
      p_aceitar: false,
      p_mensagem: null,
    });
  });

  it('propagates errors', async () => {
    const error = { message: 'agenda: este pedido já foi resolvido.' };
    mockRpc.mockResolvedValue({ data: null, error });
    await expect(resolverRemarcacao(5, true)).rejects.toBe(error);
  });
});

describe('formatAgendaError', () => {
  it('strips the agenda: prefix and capitalizes (Error instance)', () => {
    expect(formatAgendaError(new Error('agenda: este evento não existe mais'))).toBe(
      'Este evento não existe mais',
    );
  });

  it('handles a PostgrestError-like plain object', () => {
    expect(
      formatAgendaError({ message: 'agenda: você não pode editar este evento', code: 'P0001' }),
    ).toBe('Você não pode editar este evento');
  });

  it('names the Agenda when the plan lacks the feature (DB raise or edge body)', () => {
    const expected = 'O recurso "Agenda" não está disponível no seu plano.';
    expect(formatAgendaError({ message: 'feature_disabled:feature_agenda', code: 'P0001' })).toBe(
      expected,
    );
    expect(formatAgendaError({ error: 'feature_disabled', feature: 'feature_agenda' })).toBe(
      expected,
    );
  });

  it('falls back to the generic copy for anything else', () => {
    const generic = 'Não foi possível salvar o evento. Tente novamente.';
    expect(formatAgendaError(new Error('duplicate key value'))).toBe(generic);
    expect(formatAgendaError({ message: 'Failed to fetch' })).toBe(generic);
    expect(formatAgendaError('agenda')).toBe(generic);
    expect(formatAgendaError(null)).toBe(generic);
    expect(formatAgendaError(new Error('agenda: '))).toBe(generic);
  });
});

describe('ehAgendaNaoExiste', () => {
  it('matches the not-found RAISE as Error or PostgrestError-like object', () => {
    expect(ehAgendaNaoExiste(new Error('agenda: este evento não existe mais'))).toBe(true);
    expect(
      ehAgendaNaoExiste({ message: '  agenda:  Este evento não existe mais ', code: 'P0001' }),
    ).toBe(true);
  });

  it('is false for every other error', () => {
    expect(ehAgendaNaoExiste(new Error('agenda: você não pode editar este evento'))).toBe(false);
    expect(ehAgendaNaoExiste(new Error('este evento não existe mais'))).toBe(false);
    expect(ehAgendaNaoExiste({ message: 'Failed to fetch' })).toBe(false);
    expect(ehAgendaNaoExiste('agenda: este evento não existe mais')).toBe(false);
    expect(ehAgendaNaoExiste(null)).toBe(false);
  });
});
