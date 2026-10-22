import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import {
  __resetSupabaseMock,
  __getSupabaseCalls,
  __queueSupabaseRpc,
  __queueSupabaseResult,
} from '../../lib/__mocks__/supabase';
import { getWorkflowPostStatusCounts } from '../posts';
import { advanceWorkflowFromApproval, resolveWorkflowRascunhoBanner } from '../workflows';
import { resolvePostProcessRascunhoBanner } from '../postProcesses';

describe('advanceWorkflowFromApproval', () => {
  beforeEach(() => __resetSupabaseMock());

  it('chama a RPC com os parâmetros p_* e mapeia o resultado', async () => {
    __queueSupabaseRpc('advance_workflow_from_approval', {
      data: { ok: true, workflow_status: 'ativo', etapa_atual: 4, posts_changed: 2 },
    });
    await expect(
      advanceWorkflowFromApproval({
        workflowId: 7,
        expectedEtapaId: 3,
        choice: 'voltar_rascunho',
        expectedCounts: { aprovado_cliente: 2 },
      }),
    ).resolves.toEqual({ workflowStatus: 'ativo', etapaAtual: 4, postsChanged: 2 });
    const call = __getSupabaseCalls().find((c) => c.table === 'rpc:advance_workflow_from_approval');
    expect(call?.payload).toEqual({
      p_workflow_id: 7,
      p_expected_etapa_id: 3,
      p_choice: 'voltar_rascunho',
      p_expected_counts: { aprovado_cliente: 2 },
    });
  });

  it('propaga o erro da RPC', async () => {
    __queueSupabaseRpc('advance_workflow_from_approval', {
      data: null,
      error: { message: 'etapa_changed', code: 'P0001' },
    });
    await expect(
      advanceWorkflowFromApproval({
        workflowId: 7,
        expectedEtapaId: 3,
        choice: 'manter',
        expectedCounts: null,
      }),
    ).rejects.toMatchObject({ message: 'etapa_changed' });
  });
});

describe('getWorkflowPostStatusCounts', () => {
  beforeEach(() => __resetSupabaseMock());

  it('agrega os status dos posts do fluxo', async () => {
    __queueSupabaseResult('workflow_posts', 'select', {
      data: [{ status: 'rascunho' }, { status: 'rascunho' }, { status: 'agendado' }],
    });
    await expect(getWorkflowPostStatusCounts(7)).resolves.toEqual({ rascunho: 2, agendado: 1 });
  });
});

describe('resolve*RascunhoBanner', () => {
  beforeEach(() => __resetSupabaseMock());

  it('resolveWorkflowRascunhoBanner passa os parâmetros exatos', async () => {
    __queueSupabaseRpc('resolve_workflow_rascunho_banner', { data: 3 });
    await expect(resolveWorkflowRascunhoBanner(7, '2026-10-21T10:00:00Z', true)).resolves.toBe(3);
    const call = __getSupabaseCalls().find(
      (c) => c.table === 'rpc:resolve_workflow_rascunho_banner',
    );
    expect(call?.payload).toEqual({
      p_workflow_id: 7,
      p_expected_ciclo: '2026-10-21T10:00:00Z',
      p_reset: true,
    });
  });

  it('resolvePostProcessRascunhoBanner passa os parâmetros exatos', async () => {
    __queueSupabaseRpc('resolve_post_process_rascunho_banner', { data: true });
    await expect(resolvePostProcessRascunhoBanner(9, '2026-10-21T10:00:00Z', false)).resolves.toBe(
      true,
    );
    const call = __getSupabaseCalls().find(
      (c) => c.table === 'rpc:resolve_post_process_rascunho_banner',
    );
    expect(call?.payload).toEqual({
      p_process_id: 9,
      p_expected_ciclo: '2026-10-21T10:00:00Z',
      p_reset: false,
    });
  });
});
