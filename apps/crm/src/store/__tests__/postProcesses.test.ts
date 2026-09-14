import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }));

vi.mock('../core', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  getContaId: vi.fn(),
  getUserId: vi.fn(),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));
vi.mock('../mentions', () => ({ syncMentions: vi.fn() }));
vi.mock('@/components/mentions/mentionTokens', () => ({ extractMentionsFromDoc: () => [] }));

import {
  applyPostProcess,
  attachPostClosingProcess,
  detachPostsKeepingProcess,
  getPostProcessEvents,
  getVigentePostProcess,
  getVigentePostProcesses,
  removePostProcess,
  reorderFluxosBoard,
  transitionPostProcess,
  updatePostProcessStep,
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

describe('RPC wrappers (fase 4)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('detachPostsKeepingProcess envia os parâmetros exatos da RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, detached: 2 }, error: null });
    const res = await detachPostsKeepingProcess({
      postIds: [7, 3],
      workflowId: 11,
      fingerprint: 'etapa_atual=1\n0|Copy|padrao|concluido||2|corridos||',
      activeDeadline: '2026-09-15T02:59:59.999Z',
      requestId: '11111111-2222-4333-8444-555555555555',
      stepDeadlines: { '2': '2026-09-20T02:59:59.999Z' },
      archiveEmptyFlow: true,
    });
    expect(mockRpc).toHaveBeenCalledWith('detach_posts_keeping_process', {
      p_post_ids: [7, 3],
      p_workflow_id: 11,
      p_fingerprint: 'etapa_atual=1\n0|Copy|padrao|concluido||2|corridos||',
      p_active_deadline: '2026-09-15T02:59:59.999Z',
      p_request_id: '11111111-2222-4333-8444-555555555555',
      p_step_deadlines: { '2': '2026-09-20T02:59:59.999Z' },
      p_archive_empty_flow: true,
    });
    expect(res.detached).toBe(2);
  });

  it('detachPostsKeepingProcess reenvia o MESMO request_id na repetição por deadlock', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: '40P01', message: 'deadlock' } })
      .mockResolvedValueOnce({ data: { ok: true, detached: 1 }, error: null });
    await detachPostsKeepingProcess({
      postIds: [7],
      workflowId: 11,
      fingerprint: 'fp',
      activeDeadline: '2026-09-15T02:59:59.999Z',
      requestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc.mock.calls[0][1].p_request_id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(mockRpc.mock.calls[1][1].p_request_id).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    // Defaults when the optional args are omitted.
    expect(mockRpc.mock.calls[0][1].p_step_deadlines).toBeNull();
    expect(mockRpc.mock.calls[0][1].p_archive_empty_flow).toBe(false);
  });

  it('applyPostProcess envia overrides por ordem e o fingerprint do template', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, process_id: 5, revisao: 1 }, error: null });
    await applyPostProcess({
      postId: 77,
      templateId: 3,
      templateFingerprint: '0|Copy|padrao|2|corridos\n1|Design|padrao|3|uteis',
      startOrdem: 1,
      stepOverrides: { '1': { responsavel_id: 9, prazo_efetivo: '2026-09-18T02:59:59.999Z' } },
    });
    expect(mockRpc).toHaveBeenCalledWith('apply_post_process', {
      p_post_id: 77,
      p_template_id: 3,
      p_template_fingerprint: '0|Copy|padrao|2|corridos\n1|Design|padrao|3|uteis',
      p_start_ordem: 1,
      p_step_overrides: { '1': { responsavel_id: 9, prazo_efetivo: '2026-09-18T02:59:59.999Z' } },
    });
  });

  it('transitionPostProcess envia só os campos informados e nulos nos demais', async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true, revisao: 2 }, error: null });
    await transitionPostProcess({ processId: 5, expectedRevisao: 1, command: 'voltar' });
    expect(mockRpc).toHaveBeenCalledWith('transition_post_process', {
      p_process_id: 5,
      p_expected_revisao: 1,
      p_command: 'voltar',
      p_approval_choice: null,
      p_expected_post_status: null,
      p_next_deadline: null,
    });
    mockRpc.mockResolvedValueOnce({ data: { ok: true, revisao: 3 }, error: null });
    await transitionPostProcess({
      processId: 5,
      expectedRevisao: 2,
      command: 'avancar',
      approvalChoice: 'aprovar_interno',
      expectedPostStatus: 'enviado_cliente',
      nextDeadline: '2026-09-20T02:59:59.999Z',
    });
    expect(mockRpc.mock.calls[1][1]).toEqual({
      p_process_id: 5,
      p_expected_revisao: 2,
      p_command: 'avancar',
      p_approval_choice: 'aprovar_interno',
      p_expected_post_status: 'enviado_cliente',
      p_next_deadline: '2026-09-20T02:59:59.999Z',
    });
  });

  it('updatePostProcessStep, removePostProcess, attachPostClosingProcess, reorderFluxosBoard', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await updatePostProcessStep({
      processId: 5,
      expectedRevisao: 1,
      ordem: 1,
      responsavelId: null,
      prazoEfetivo: null,
    });
    expect(mockRpc).toHaveBeenLastCalledWith('update_post_process_step', {
      p_process_id: 5,
      p_expected_revisao: 1,
      p_ordem: 1,
      p_responsavel_id: null,
      p_prazo_efetivo: null,
      p_prazo_dias: undefined,
      p_tipo_prazo: undefined,
    });
    // modo_prazo='padrao': prazoDias/tipoPrazo chegam na RPC junto com o
    // prazoEfetivo recalculado (spec §2) -- nunca só os dois novos sozinhos.
    await updatePostProcessStep({
      processId: 5,
      expectedRevisao: 2,
      ordem: 1,
      responsavelId: 9,
      prazoEfetivo: '2026-09-25T02:59:59.999Z',
      prazoDias: 3,
      tipoPrazo: 'uteis',
    });
    expect(mockRpc).toHaveBeenLastCalledWith('update_post_process_step', {
      p_process_id: 5,
      p_expected_revisao: 2,
      p_ordem: 1,
      p_responsavel_id: 9,
      p_prazo_efetivo: '2026-09-25T02:59:59.999Z',
      p_prazo_dias: 3,
      p_tipo_prazo: 'uteis',
    });
    await removePostProcess(5, 1);
    expect(mockRpc).toHaveBeenLastCalledWith('remove_post_process', {
      p_process_id: 5,
      p_expected_revisao: 1,
    });
    await attachPostClosingProcess(77, 11, 1);
    expect(mockRpc).toHaveBeenLastCalledWith('attach_post_closing_process', {
      p_post_id: 77,
      p_workflow_id: 11,
      p_expected_revisao: 1,
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await reorderFluxosBoard({
      workflowIds: [1, 2],
      workflowPositions: [0, 2],
      processIds: [5],
      processPositions: [1],
    });
    expect(mockRpc).toHaveBeenLastCalledWith('reorder_fluxos_board', {
      p_workflow_ids: [1, 2],
      p_workflow_positions: [0, 2],
      p_process_ids: [5],
      p_process_positions: [1],
    });
  });

  it('propaga o erro identificador da RPC sem retry fora de 40P01', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'process_changed' },
    });
    await expect(removePostProcess(5, 1)).rejects.toMatchObject({ message: 'process_changed' });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
