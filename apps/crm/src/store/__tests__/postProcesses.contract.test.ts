/**
 * Contrato ao vivo dos sete invólucros de RPC contra um Supabase LOCAL
 * (supabase start + db reset). Pulado sem as duas variáveis abaixo. Prova que
 * os nomes de parâmetro que o CRM manda batem com as funções implantadas:
 * parâmetro errado = PGRST202; parâmetro certo = P0001 com um identificador
 * da tabela de erros (service_role não tem auth.uid(), então
 * post_process_require_editor responde workspace_not_found antes de qualquer
 * escrita). Nunca aponte para staging/prod: a chave é a service_role local.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const env = vi.hoisted(() => ({
  url: process.env.POST_PROCESS_CONTRACT_URL,
  key: process.env.POST_PROCESS_CONTRACT_SERVICE_KEY,
}));

vi.mock('../core', async () => {
  if (!env.url || !env.key) return { supabase: {} };
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient(env.url, env.key),
    getContaId: vi.fn(),
    getUserId: vi.fn(),
    getCurrentProfile: vi.fn(),
    clearProfileCache: vi.fn(),
  };
});

import {
  applyPostProcess,
  attachPostClosingProcess,
  detachPostsKeepingProcess,
  removePostProcess,
  reorderFluxosBoard,
  transitionPostProcess,
  updatePostProcessStep,
} from '../postProcesses';
import { POST_PROCESS_ERROR_MESSAGES } from '../../pages/entregas/postProcessErrors';

const enabled = !!env.url && !!env.key && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(env.url);

describe.skipIf(!enabled)('post process RPC contract (local Supabase)', () => {
  const expectIdentifier = async (p: Promise<unknown>) => {
    let err: { code?: string; message?: string } | null = null;
    try {
      await p;
    } catch (e) {
      err = e as { code?: string; message?: string };
    }
    expect(err, 'a RPC tem de falhar (sem auth.uid())').not.toBeNull();
    expect(err!.code, err!.message).toBe('P0001');
    expect(Object.keys(POST_PROCESS_ERROR_MESSAGES)).toContain(err!.message);
  };

  it('createClient sanity', () => {
    expect(createClient).toBeTypeOf('function');
  });
  it('detach_posts_keeping_process', () =>
    expectIdentifier(
      detachPostsKeepingProcess({
        postIds: [1],
        workflowId: 1,
        fingerprint: 'etapa_atual=0',
        activeDeadline: new Date().toISOString(),
        requestId: '11111111-2222-4333-8444-555555555555',
        stepDeadlines: { '1': new Date().toISOString() },
        archiveEmptyFlow: false,
      }),
    ));
  it('apply_post_process', () =>
    expectIdentifier(
      applyPostProcess({
        postId: 1,
        templateId: 1,
        templateFingerprint: '0|Copy|padrao|2|corridos',
        startOrdem: 0,
        stepOverrides: { '0': { responsavel_id: null, prazo_efetivo: new Date().toISOString() } },
      }),
    ));
  it('transition_post_process', () =>
    expectIdentifier(
      transitionPostProcess({
        processId: 1,
        expectedRevisao: 1,
        command: 'avancar',
        approvalChoice: 'sem_alterar',
        expectedPostStatus: 'rascunho',
        nextDeadline: new Date().toISOString(),
      }),
    ));
  it('update_post_process_step', () =>
    expectIdentifier(
      updatePostProcessStep({
        processId: 1,
        expectedRevisao: 1,
        ordem: 0,
        responsavelId: null,
        prazoEfetivo: null,
      }),
    ));
  it('remove_post_process', () => expectIdentifier(removePostProcess(1, 1)));
  it('attach_post_closing_process', () => expectIdentifier(attachPostClosingProcess(1, 1, 1)));
  it('reorder_fluxos_board', () =>
    expectIdentifier(
      reorderFluxosBoard({
        workflowIds: [1],
        workflowPositions: [0],
        processIds: [1],
        processPositions: [1],
      }),
    ));
});
