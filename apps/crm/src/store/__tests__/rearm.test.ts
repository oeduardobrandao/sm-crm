import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import {
  __getSupabaseCalls,
  __queueSupabaseResult,
  __resetSupabaseMock,
} from '../../lib/__mocks__/supabase';
import { completeEtapaWithRearm, hasLaterApprovalEtapa, type WorkflowEtapa } from '../workflows';

function etapa(partial: Partial<WorkflowEtapa> & { id: number; ordem: number }): WorkflowEtapa {
  return {
    workflow_id: 1,
    nome: `Etapa ${partial.ordem}`,
    prazo_dias: 3,
    tipo_prazo: 'corridos',
    status: 'pendente',
    tipo: 'padrao',
    ...partial,
  };
}

describe('hasLaterApprovalEtapa', () => {
  const dupla = [
    etapa({ id: 10, ordem: 0, nome: 'Redação' }),
    etapa({ id: 11, ordem: 1, nome: 'Aprovação do texto', tipo: 'aprovacao_cliente' }),
    etapa({ id: 12, ordem: 2, nome: 'Design' }),
    etapa({ id: 13, ordem: 3, nome: 'Aprovação da arte', tipo: 'aprovacao_cliente' }),
    etapa({ id: 14, ordem: 4, nome: 'Agendamento' }),
  ];

  it('true when a later aprovacao_cliente etapa exists', () => {
    expect(hasLaterApprovalEtapa(dupla, 11)).toBe(true);
  });

  it('false for the last approval etapa', () => {
    expect(hasLaterApprovalEtapa(dupla, 13)).toBe(false);
  });

  it('false for a non-approval etapa followed only by padrao etapas', () => {
    expect(hasLaterApprovalEtapa(dupla, 14)).toBe(false);
  });

  it('false for an unknown etapa id', () => {
    expect(hasLaterApprovalEtapa(dupla, 999)).toBe(false);
  });
});

describe('completeEtapaWithRearm', () => {
  beforeEach(() => __resetSupabaseMock());

  const queueEtapas = (rows: WorkflowEtapa[]) => {
    // 1st select: the pre-check inside completeEtapaWithRearm;
    // 2nd + 3rd: getWorkflowEtapas calls inside completeEtapa.
    __queueSupabaseResult('workflow_etapas', 'select', { data: rows });
    __queueSupabaseResult('workflow_etapas', 'select', { data: rows });
    __queueSupabaseResult('workflow_etapas', 'select', { data: rows });
    __queueSupabaseResult('workflow_etapas', 'update', { data: rows[1] });
    __queueSupabaseResult('workflow_etapas', 'update', { data: rows[2] });
    __queueSupabaseResult('workflows', 'update', { data: { id: 1, status: 'ativo' } });
  };

  it('resets ONLY aprovado_cliente posts when a later approval exists', async () => {
    queueEtapas([
      etapa({ id: 10, ordem: 0 }),
      etapa({ id: 11, ordem: 1, tipo: 'aprovacao_cliente', status: 'ativo' }),
      etapa({ id: 12, ordem: 2 }),
      etapa({ id: 13, ordem: 3, tipo: 'aprovacao_cliente' }),
    ]);
    const result = await completeEtapaWithRearm(1, 11);
    expect(result.rearmed).toBe(true);
    expect(result.rearmFailed).toBe(false);
    const reset = __getSupabaseCalls().find(
      (c) => c.table === 'workflow_posts' && c.operation === 'update',
    )!;
    expect(reset.payload).toEqual({ status: 'rascunho' });
    expect(reset.modifiers).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['workflow_id', 1] },
        { method: 'eq', args: ['status', 'aprovado_cliente'] },
      ]),
    );
  });

  it('does not touch posts when no later approval etapa exists', async () => {
    queueEtapas([
      etapa({ id: 10, ordem: 0 }),
      etapa({ id: 11, ordem: 1, tipo: 'aprovacao_cliente', status: 'ativo' }),
      etapa({ id: 12, ordem: 2 }),
    ]);
    const result = await completeEtapaWithRearm(1, 11);
    expect(result.rearmed).toBe(false);
    expect(
      __getSupabaseCalls().some((c) => c.table === 'workflow_posts' && c.operation === 'update'),
    ).toBe(false);
  });

  it('resolves with rearmFailed when the reset errors after a successful advance', async () => {
    queueEtapas([
      etapa({ id: 11, ordem: 0, tipo: 'aprovacao_cliente', status: 'ativo' }),
      etapa({ id: 12, ordem: 1 }),
      etapa({ id: 13, ordem: 2, tipo: 'aprovacao_cliente' }),
    ]);
    __queueSupabaseResult('workflow_posts', 'update', { error: new Error('rls boom') });
    const result = await completeEtapaWithRearm(1, 11);
    expect(result.rearmed).toBe(false);
    expect(result.rearmFailed).toBe(true);
  });
});
