import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../store', () => ({
  completeEtapa: vi.fn(),
  completeEtapaWithRearm: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  approvePostsInternally: vi.fn(),
  sendPostsToCliente: vi.fn(),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
  reorderFluxosBoard: vi.fn(),
  getDeadlineInfo: vi.fn(),
  addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(),
  addWorkflowTemplate: vi.fn(),
  removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowEtapa: vi.fn(),
  updateWorkflowTemplate: vi.fn(),
  propagateTemplateToWorkflows: vi.fn(),
  getPropertyDefinitions: vi.fn(),
  deletePropertyDefinition: vi.fn(),
  getWorkflows: vi.fn(),
  getClientes: vi.fn(),
  getMembros: vi.fn(),
  getWorkflowTemplates: vi.fn(),
  getWorkflowEtapas: vi.fn(),
  getWorkflowPostsCounts: vi.fn(),
  getWorkflowApprovedPostsCounts: vi.fn(),
  getWorkflowClearedClientePostsCounts: vi.fn(),
  getWorkflowRevisaoInternaCounts: vi.fn(),
  getWorkflowAwaitingClientePostsCounts: vi.fn(),
  getWorkflowPostResponsaveis: vi.fn(),
  getWorkspaceSlug: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { fullColumnOrder, fullMixedColumnOrder } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { PostEntity } from '../../boardEntity';

const etapa = {
  id: 11,
  workflow_id: 1,
  ordem: 1,
  nome: 'Produção',
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'padrao' as const,
  status: 'ativo' as const,
};

function card(id: number, position: number): BoardCard {
  return {
    workflow: {
      id,
      cliente_id: 1,
      titulo: `WF ${id}`,
      status: 'ativo',
      etapa_atual: 1,
      recorrente: false,
      template_id: 7,
      position,
    },
    etapa: { ...etapa, workflow_id: id },
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 2,
    etapaIdx: 1,
    allEtapas: [{ ...etapa, workflow_id: id }],
  } as unknown as BoardCard;
}

describe('fullColumnOrder', () => {
  it('em modo manual devolve a coluna inteira por position, incluindo ocultos', () => {
    const all = [card(1, 0), card(2, 1), card(3, 2)];
    const visible = [all[0], all[2]];
    expect(fullColumnOrder(all, visible, 'template:7', 1, [], 'manual')).toEqual([1, 2, 3]);
  });

  it('sem allCards cai na lista visível', () => {
    const visible = [card(3, 0), card(1, 1)];
    expect(fullColumnOrder(undefined, visible, 'template:7', 1, [], 'manual')).toEqual([3, 1]);
  });

  it('honra positions ja sobrepostas pelo overlay otimista de um drag anterior', () => {
    // Servidor ainda reporta [1→0, 2→1, 3→2] (refetch do 1o drag nao chegou),
    // mas o chamador (localAllCards) ja aplicou o overlay otimista do 1o
    // drag: card 3 movido para o topo (position -1). fullColumnOrder é pura
    // e so ordena o que recebe, entao ela precisa refletir esse overlay.
    const all = [
      card(1, 0),
      card(2, 1),
      { ...card(3, 2), workflow: { ...card(3, 2).workflow, position: -1 } },
    ];
    const visible = all;
    expect(fullColumnOrder(all, visible, 'template:7', 1, [], 'manual')).toEqual([3, 1, 2]);
  });

  it('em modo prazo ordena a coluna inteira por prazo, incluindo ocultos', () => {
    // sortCardsByPrazo (etapaPrazo.ts) ordena por prazo mais curto primeiro
    // (Infinity para quem nao tem data_limite), entao 2026 < 2099 < sem prazo.
    const withDataLimite = (id: number, position: number, data_limite: string | null) => {
      const c = card(id, position);
      return { ...c, etapa: { ...c.etapa, data_limite } } as BoardCard;
    };
    const all = [
      withDataLimite(1, 0, '2099-01-01'),
      withDataLimite(2, 1, '2026-01-01'),
      withDataLimite(3, 2, null),
    ];
    const visible = [all[0], all[2]]; // card 2 (2026) oculto pelo filtro
    expect(fullColumnOrder(all, visible, 'template:7', 1, [], 'prazo')).toEqual([2, 1, 3]);
  });
});

// template_id 7 (não 2) para ficar na MESMA linha ('template:7') que o
// card() acima: buildBoardRows agrupa por templateId, então um postEntity com
// outro template cairia numa linha diferente e nunca se juntaria aos fluxos.
function postEntity(processId: number, posicao: number): PostEntity {
  return {
    kind: 'post',
    id: `post:${processId}`,
    templateId: 7,
    steps: [{ ordem: 1, nome: 'Produção', tipo: 'padrao' }],
    etapaOrdem: 1,
    etapaNome: 'Produção',
    responsavel: undefined,
    prazoEfetivo: null,
    posicao,
    deadline: { diasRestantes: 0, horasRestantes: 0, estourado: false, urgente: false },
    cliente: undefined,
    titulo: `Post ${processId}`,
    process: {
      id: processId,
      post_id: 100 + processId,
      template_id: 7,
      estado: 'ativo',
      etapa_atual: 1,
      steps: [],
    } as never,
    step: { ordem: 1, estado: 'ativo' } as never,
  };
}

describe('fullMixedColumnOrder', () => {
  it('modo manual: fluxos e posts intercalados por posicao, incluindo ocultos pelo filtro', () => {
    const all = [card(1, 0), card(2, 3)];
    const allPosts = [postEntity(9, 1), postEntity(8, 2)];
    const ids = fullMixedColumnOrder(
      all,
      allPosts,
      [card(1, 0)],
      [postEntity(9, 1)],
      'template:7',
      1,
      [],
      'manual',
    );
    expect(ids).toEqual(['1', 'post:9', 'post:8', '2']);
  });
  it('sem posts devolve exatamente fullColumnOrder (caminho da fase 3)', () => {
    const all = [card(1, 2), card(2, 0)];
    expect(fullMixedColumnOrder(all, [], all, [], 'template:7', 1, [], 'manual')).toEqual([
      '2',
      '1',
    ]);
  });
});
