import { describe, expect, it } from 'vitest';

import { hasLaterApprovalEtapa, type WorkflowEtapa } from '../workflows';

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
