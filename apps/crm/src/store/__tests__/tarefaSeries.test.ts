import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom, mockGetContaId, mockGetUserId, mockSyncMentions } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
  mockGetContaId: vi.fn(),
  mockGetUserId: vi.fn(),
  mockSyncMentions: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
  getUserId: mockGetUserId,
  getContaId: mockGetContaId,
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));
vi.mock('../mentions', () => ({ syncMentions: mockSyncMentions }));

import {
  aplicarEdicaoSerie,
  criarTarefaSerie,
  definirEstadoSerie,
  deleteTarefaSerieCompleta,
  getTarefas,
  isSerieDateConflict,
  isSerieSemPrazo,
  type TarefaSerieRegra,
} from '../tarefas';

const REGRA: TarefaSerieRegra = {
  freq: 'weekly',
  intervalo: 1,
  dias_semana: [1],
  dia_mes: null,
  mes: null,
  modo: 'ao_concluir',
  fim: null,
};
const PAYLOAD = {
  titulo: 'Relatório',
  descricao: 'oi @[Ana](membro:7)',
  descricao_rich: null,
  status: 'pendente' as const,
  responsavel_id: 3,
  cliente_id: null,
  data_limite: '2026-01-05',
};

describe('tarefa series store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncMentions.mockResolvedValue(undefined);
  });

  it('criarTarefaSerie calls the RPC with the exact JSON contract and returns the ids', async () => {
    mockRpc.mockResolvedValue({ data: [{ serie_id: 10, tarefa_id: 20 }], error: null });
    const out = await criarTarefaSerie(REGRA, PAYLOAD, [1, 2], ['a', 'b']);
    expect(mockRpc).toHaveBeenCalledWith('tarefa_serie_criar', {
      p_serie: REGRA,
      p_tarefa: PAYLOAD,
      p_tag_ids: [1, 2],
      p_subtarefas: ['a', 'b'],
      p_tarefa_id: null,
    });
    expect(out).toEqual({ serie_id: 10, tarefa_id: 20 });
  });

  it('criarTarefaSerie passes p_tarefa_id for a promotion and syncs mentions after the RPC', async () => {
    mockRpc.mockResolvedValue({ data: [{ serie_id: 10, tarefa_id: 42 }], error: null });
    await criarTarefaSerie(REGRA, PAYLOAD, [], [], 42);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_tarefa_id: 42 });
    expect(mockSyncMentions).toHaveBeenCalledWith('tarefa', 42, [7]);
  });

  it('criarTarefaSerie throws (and syncs nothing) when the RPC returns no row', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(criarTarefaSerie(REGRA, PAYLOAD, [], [])).rejects.toThrow(/returned no row/);
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(criarTarefaSerie(REGRA, PAYLOAD, [], [])).rejects.toThrow(/returned no row/);
    expect(mockSyncMentions).not.toHaveBeenCalled();
  });

  it('criarTarefaSerie throws the RPC error (message and code preserved)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Para repetir, o prazo precisa ser hoje ou depois.' },
    });
    await expect(criarTarefaSerie(REGRA, PAYLOAD, [], [])).rejects.toMatchObject({
      code: 'P0001',
      message: 'Para repetir, o prazo precisa ser hoje ou depois.',
    });
    expect(mockSyncMentions).not.toHaveBeenCalled();
  });

  it('aplicarEdicaoSerie sends the full payload, full tag set, whole rule and the encerrar flag', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await aplicarEdicaoSerie(42, PAYLOAD, [5], REGRA, true);
    expect(mockRpc).toHaveBeenCalledWith('tarefa_serie_aplicar_edicao', {
      p_tarefa_id: 42,
      p_tarefa: PAYLOAD,
      p_tag_ids: [5],
      p_regra: REGRA,
      p_encerrar: true,
    });
    expect(mockSyncMentions).toHaveBeenCalledWith('tarefa', 42, [7]);
  });

  it('definirEstadoSerie and deleteTarefaSerieCompleta call their RPCs', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await definirEstadoSerie(10, 'pausar');
    expect(mockRpc).toHaveBeenCalledWith('tarefa_serie_definir_estado', {
      p_serie_id: 10,
      p_estado: 'pausar',
    });
    await deleteTarefaSerieCompleta(10);
    expect(mockRpc).toHaveBeenCalledWith('tarefa_serie_excluir', { p_serie_id: 10 });
  });

  it('getTarefas embeds tarefa_series and flattens it into serie', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: 1,
          titulo: 'x',
          status: 'pendente',
          clientes: null,
          tarefa_tag_links: [],
          subtarefas: [],
          tarefa_series: {
            id: 9,
            freq: 'daily',
            intervalo: 1,
            dias_semana: null,
            dia_mes: null,
            mes: null,
            modo: 'calendario',
            inicio: '2026-01-05',
            fim: null,
            pausada: false,
            encerrada_em: null,
            proxima_data: '2026-01-06',
          },
        },
        {
          id: 2,
          titulo: 'y',
          status: 'pendente',
          clientes: null,
          tarefa_tag_links: [],
          subtarefas: [],
          tarefa_series: null,
        },
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ order });
    mockFrom.mockReturnValue({ select });
    const rows = await getTarefas();
    expect(select.mock.calls[0][0]).toContain(
      'tarefa_series(id, freq, intervalo, dias_semana, dia_mes, mes, modo, inicio, fim, pausada, encerrada_em, proxima_data)',
    );
    expect(rows[0].serie?.id).toBe(9);
    expect(rows[1].serie).toBeNull();
    expect('tarefa_series' in rows[0]).toBe(false);
  });

  it('isSerieDateConflict / isSerieSemPrazo match the constraint names', () => {
    expect(
      isSerieDateConflict({
        code: '23505',
        message: 'duplicate key value violates unique constraint "tarefas_serie_data_uq"',
      }),
    ).toBe(true);
    expect(isSerieDateConflict({ code: '23505', message: 'other' })).toBe(false);
    expect(isSerieDateConflict(new Error('x'))).toBe(false);
    expect(
      isSerieSemPrazo({
        code: '23514',
        message: 'new row violates check constraint "tarefas_serie_exige_prazo"',
      }),
    ).toBe(true);
    expect(isSerieSemPrazo(null)).toBe(false);
  });
});
