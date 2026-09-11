import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock('../core', () => ({
  supabase: { from: mockFrom },
  getContaId: vi.fn(),
  getUserId: vi.fn(),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));
vi.mock('../mentions', () => ({ syncMentions: vi.fn() }));
vi.mock('@/components/mentions/mentionTokens', () => ({ extractMentionsFromDoc: () => [] }));

import {
  getPostProcessEvents,
  getVigentePostProcess,
  getVigentePostProcesses,
} from '../postProcesses';

/** Thenable query builder: every filter returns itself, awaiting resolves `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'maybeSingle']) q[m] = vi.fn(self);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return q;
}

const processRow = {
  id: 5,
  conta_id: 'c1',
  post_id: 77,
  template_id: 3,
  template_nome: 'Redes',
  assinatura: '0|Copy|padrao\n1|Design|padrao',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'ativo',
  motivo_encerramento: null,
  etapa_atual: 1,
  modo_prazo: 'padrao',
  board_position: 2,
  revisao: 1,
  created_by: null,
  created_at: '2026-09-10T10:00:00Z',
  updated_at: '2026-09-10T10:00:00Z',
  concluido_em: null,
  post_process_steps: [
    { id: 12, process_id: 5, ordem: 1, nome: 'Design', estado: 'ativo' },
    { id: 11, process_id: 5, ordem: 0, nome: 'Copy', estado: 'ignorado' },
  ],
  workflow_posts: {
    id: 77,
    workflow_id: null,
    cliente_id: 9,
    titulo: 'Post X',
    tipo: 'feed',
    status: 'rascunho',
    ordem: 0,
    clientes: { nome: 'Aurora' },
  },
};

describe('getVigentePostProcesses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('faz UMA consulta em post_processes com os dois estados vigentes e mapeia steps e post', async () => {
    const q = chain({ data: [processRow], error: null });
    mockFrom.mockReturnValueOnce(q);
    const out = await getVigentePostProcesses();
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('post_processes');
    expect(q.in).toHaveBeenCalledWith('estado', ['ativo', 'concluido']);
    expect(out).toHaveLength(1);
    expect(out[0].steps.map((s) => s.ordem)).toEqual([0, 1]);
    expect(out[0].post).toMatchObject({
      id: 77,
      workflow_id: null,
      cliente_id: 9,
      cliente_nome: 'Aurora',
      workflow_titulo: null,
    });
    expect((out[0] as unknown as Record<string, unknown>).post_process_steps).toBeUndefined();
    expect((out[0] as unknown as Record<string, unknown>).workflow_posts).toBeUndefined();
  });

  it('propaga o erro do PostgREST', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: new Error('boom') }));
    await expect(getVigentePostProcesses()).rejects.toThrow('boom');
  });
});

describe('getVigentePostProcess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve null sem processo vigente e o processo com steps ordenados quando existe', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }));
    expect(await getVigentePostProcess(77)).toBeNull();

    const { workflow_posts: _p, ...withoutPost } = processRow;
    const q = chain({ data: withoutPost, error: null });
    mockFrom.mockReturnValueOnce(q);
    const proc = await getVigentePostProcess(77);
    expect(q.eq).toHaveBeenCalledWith('post_id', 77);
    expect(q.in).toHaveBeenCalledWith('estado', ['ativo', 'concluido']);
    expect(proc?.steps.map((s) => s.nome)).toEqual(['Copy', 'Design']);
  });
});

describe('getPostProcessEvents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('não consulta com lista vazia e filtra por post_id em lote', async () => {
    expect(await getPostProcessEvents([])).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
    const q = chain({ data: [{ id: 1, post_id: 77, evento: 'aplicado' }], error: null });
    mockFrom.mockReturnValueOnce(q);
    const evs = await getPostProcessEvents([77, 78]);
    expect(mockFrom).toHaveBeenCalledWith('post_process_events');
    expect(q.in).toHaveBeenCalledWith('post_id', [77, 78]);
    expect(evs).toHaveLength(1);
  });
});
