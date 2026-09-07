import { describe, expect, it } from 'vitest';
import {
  filterMoveTargets,
  getMoveErrorToast,
} from '../pages/entregas/components/MovePostsToFluxoDialog';
import type { Workflow } from '../store';

function wf(overrides: Partial<Workflow>): Workflow {
  return {
    id: 1,
    cliente_id: 10,
    titulo: 'Fluxo',
    template_id: 7,
    status: 'ativo',
    etapa_atual: 0,
    recorrente: false,
    ...overrides,
  };
}

describe('filterMoveTargets', () => {
  const source = wf({ id: 1, titulo: 'Origem' });

  it('mantém só fluxos ativos do mesmo cliente e mesmo template, excluindo a origem, ordenados por título', () => {
    const targets = filterMoveTargets(
      [
        source,
        wf({ id: 2, titulo: 'Beta' }),
        wf({ id: 3, titulo: 'Alfa' }),
        wf({ id: 4, titulo: 'Arquivado', status: 'arquivado' }),
        wf({ id: 5, titulo: 'Concluído', status: 'concluido' }),
        wf({ id: 6, titulo: 'Outro cliente', cliente_id: 99 }),
        wf({ id: 7, titulo: 'Outro template', template_id: 8 }),
        wf({ id: 8, titulo: 'Sem template', template_id: null }),
      ],
      source,
    );

    expect(targets.map((w) => w.id)).toEqual([3, 2]);
  });

  it('origem sem template não tem irmãos de "mesmo modelo": lista vazia mesmo com outro fluxo também sem template', () => {
    const noTemplate = wf({ id: 1, template_id: null });
    expect(filterMoveTargets([noTemplate, wf({ id: 2, template_id: null })], noTemplate)).toEqual(
      [],
    );
  });
});

describe('getMoveErrorToast', () => {
  it.each([
    ['workflow_not_found', 'Fluxo de destino não encontrado.'],
    ['workflow_not_active', 'O fluxo de destino não está mais ativo.'],
    ['workflow_different_client', 'O fluxo de destino pertence a outro cliente.'],
    [
      'workflow_template_mismatch',
      'O fluxo de destino precisa usar o mesmo modelo do fluxo atual.',
    ],
    ['post_not_found', 'Um ou mais posts não foram encontrados.'],
    ['post_not_in_source_flow', 'Os posts selecionados precisam estar todos neste fluxo.'],
    ['post_not_in_flow', 'Os posts selecionados precisam estar todos neste fluxo.'],
    ['posts_in_multiple_flows', 'Os posts selecionados precisam estar todos neste fluxo.'],
    ['invalid_start_etapa', 'Escolha uma etapa válida para o novo fluxo.'],
    ['titulo_required', 'Informe um nome para o novo fluxo.'],
  ])('mapeia %s para a copy própria', (identifier, expected) => {
    expect(getMoveErrorToast({ message: identifier })).toBe(expected);
  });

  it('usa a copy padrão de entitlement para os dois limites de plano que a operação pode estourar', () => {
    expect(getMoveErrorToast({ message: 'plan_limit_exceeded:max_posts_per_workflow' })).toBe(
      'Você atingiu o limite de posts por fluxo do seu plano.',
    );
    expect(
      getMoveErrorToast({ message: 'plan_limit_exceeded:max_active_workflows_per_client' }),
    ).toBe('Você atingiu o limite de fluxos ativos por cliente do seu plano.');
  });

  it('cai no fallback genérico para identificadores desconhecidos e erros sem message', () => {
    expect(getMoveErrorToast({ message: 'target_is_source' })).toBe(
      'Erro ao mover posts para outro fluxo',
    );
    expect(getMoveErrorToast(new Error('boom'))).toBe('Erro ao mover posts para outro fluxo');
    expect(getMoveErrorToast(null)).toBe('Erro ao mover posts para outro fluxo');
  });
});
