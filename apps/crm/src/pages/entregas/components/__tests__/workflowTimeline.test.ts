import { describe, it, expect } from 'vitest';
import { buildWorkflowTimeline } from '../workflowTimeline';
import type { WorkflowEvent } from '../../../../store';

function ev(partial: Partial<WorkflowEvent>): WorkflowEvent {
  return {
    id: 1,
    workflow_id: 10,
    conta_id: 'conta-1',
    event_type: 'criado',
    etapa_id: null,
    etapa_nome: null,
    source: 'workspace_user',
    actor_user_id: null,
    actor_name: null,
    metadata: {},
    created_at: '2026-06-01T10:00:00Z',
    ...partial,
  };
}

describe('buildWorkflowTimeline', () => {
  describe('labels', () => {
    it.each<[WorkflowEvent['event_type'], Partial<WorkflowEvent>, string]>([
      ['criado', {}, 'Fluxo criado'],
      ['etapa_iniciada', { etapa_nome: 'Roteiro' }, 'Etapa iniciada: Roteiro'],
      ['etapa_concluida', { etapa_nome: 'Roteiro' }, 'Etapa concluída: Roteiro'],
      [
        'etapa_revertida',
        { etapa_nome: 'Roteiro', metadata: { voltou_de: 'Edição' } },
        'Etapa revertida: Edição → Roteiro',
      ],
      ['etapa_editada', { etapa_nome: 'Roteiro' }, 'Etapa editada: Roteiro'],
      ['fluxo_editado', {}, 'Fluxo editado'],
      ['fluxo_concluido', {}, 'Fluxo concluído'],
      ['fluxo_reaberto', {}, 'Fluxo reaberto'],
      ['fluxo_arquivado', {}, 'Fluxo arquivado'],
      [
        'template_migrado',
        { metadata: { from_template_nome: 'Padrão', to_template_nome: 'Novo' } },
        'Template migrado: Padrão → Novo',
      ],
      [
        'template_propagado',
        { metadata: { template_nome: 'Padrão' } },
        'Template atualizado: Padrão',
      ],
    ])('labels %s correctly', (event_type, partial, expected) => {
      const [node] = buildWorkflowTimeline([ev({ event_type, ...partial })]);
      expect(node.label).toBe(expected);
    });

    it('falls back to the missing-name placeholder when etapa_nome/metadata names are absent', () => {
      const [node] = buildWorkflowTimeline([
        ev({ event_type: 'etapa_iniciada', etapa_nome: null }),
      ]);
      expect(node.label).toBe('Etapa iniciada: —');
    });

    it('falls back to the raw event_type string for an unknown/future event type', () => {
      const [node] = buildWorkflowTimeline([
        ev({ event_type: 'evento_futuro' as unknown as WorkflowEvent['event_type'] }),
      ]);
      expect(node.label).toBe('evento_futuro');
    });
  });

  describe('ordering', () => {
    it('sorts by created_at regardless of input order', () => {
      const nodes = buildWorkflowTimeline([
        ev({ id: 2, event_type: 'fluxo_editado', created_at: '2026-06-05T10:00:00Z' }),
        ev({ id: 1, event_type: 'criado', created_at: '2026-06-01T10:00:00Z' }),
      ]);
      expect(nodes.map((n) => n.key)).toEqual(['event-1', 'event-2']);
    });

    it('breaks a same-created_at tie by id ascending', () => {
      const nodes = buildWorkflowTimeline([
        ev({ id: 5, event_type: 'fluxo_editado', created_at: '2026-06-01T10:00:00Z' }),
        ev({ id: 3, event_type: 'criado', created_at: '2026-06-01T10:00:00Z' }),
      ]);
      expect(nodes.map((n) => n.key)).toEqual(['event-3', 'event-5']);
    });

    it('does not mutate the input array', () => {
      const input = [
        ev({ id: 2, created_at: '2026-06-05T10:00:00Z' }),
        ev({ id: 1, created_at: '2026-06-01T10:00:00Z' }),
      ];
      const copy = [...input];
      buildWorkflowTimeline(input);
      expect(input).toEqual(copy);
    });
  });

  describe('diffs', () => {
    it('prefers from_label/to_label over raw ids for FK fields', () => {
      const [node] = buildWorkflowTimeline([
        ev({
          event_type: 'fluxo_editado',
          metadata: {
            changes: [
              {
                field: 'cliente_id',
                from: 1,
                to: 2,
                from_label: 'Cliente A',
                to_label: 'Cliente B',
              },
            ],
          },
        }),
      ]);
      expect(node.diffs).toEqual(['Cliente: Cliente A → Cliente B']);
    });

    it('renders recorrente as Sim/Não', () => {
      const [node] = buildWorkflowTimeline([
        ev({
          event_type: 'fluxo_editado',
          metadata: { changes: [{ field: 'recorrente', from: false, to: true }] },
        }),
      ]);
      expect(node.diffs).toEqual(['Recorrente: Não → Sim']);
    });

    it('renders prazo_dias as "N dias"', () => {
      const [node] = buildWorkflowTimeline([
        ev({
          event_type: 'etapa_editada',
          metadata: { changes: [{ field: 'prazo_dias', from: 2, to: 5 }] },
        }),
      ]);
      expect(node.diffs).toEqual(['Prazo: 2 dias → 5 dias']);
    });

    it('renders a missing/null raw value as —', () => {
      const [node] = buildWorkflowTimeline([
        ev({
          event_type: 'fluxo_editado',
          metadata: { changes: [{ field: 'link_notion', from: null, to: 'https://notion.so/x' }] },
        }),
      ]);
      expect(node.diffs).toEqual(['Link Notion: — → https://notion.so/x']);
    });

    it('produces an empty diffs array when metadata.changes is absent', () => {
      const [node] = buildWorkflowTimeline([ev({ event_type: 'fluxo_editado', metadata: {} })]);
      expect(node.diffs).toEqual([]);
    });

    it('produces an empty diffs array when metadata.changes is empty', () => {
      const [node] = buildWorkflowTimeline([
        ev({ event_type: 'fluxo_editado', metadata: { changes: [] } }),
      ]);
      expect(node.diffs).toEqual([]);
    });

    it('formats data_limite as pt-BR and tipo_prazo uteis with the accent restored', () => {
      const [node] = buildWorkflowTimeline([
        ev({
          event_type: 'etapa_editada',
          metadata: {
            changes: [
              { field: 'data_limite', from: '2026-06-01', to: '2026-06-10' },
              { field: 'tipo_prazo', from: 'corridos', to: 'uteis' },
            ],
          },
        }),
      ]);
      expect(node.diffs).toEqual([
        'Data limite: 01/06/2026 → 10/06/2026',
        'Tipo de prazo: corridos → úteis',
      ]);
    });
  });

  describe('tempo na etapa (detail)', () => {
    it('computes duration from the preceding etapa_iniciada for the same etapa_id', () => {
      const nodes = buildWorkflowTimeline([
        ev({ id: 1, event_type: 'criado', created_at: '2026-06-01T10:00:00Z' }),
        ev({
          id: 2,
          event_type: 'etapa_iniciada',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          created_at: '2026-06-01T10:00:00Z',
        }),
        ev({
          id: 3,
          event_type: 'etapa_concluida',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          created_at: '2026-06-04T10:00:00Z',
        }),
      ]);
      const concluded = nodes.find((n) => n.key === 'event-3')!;
      expect(concluded.detail).toBe('3 dia(s) na etapa');
    });

    it('falls back to the criado event when the first etapa has no etapa_iniciada', () => {
      const nodes = buildWorkflowTimeline([
        ev({ id: 1, event_type: 'criado', created_at: '2026-06-01T10:00:00Z' }),
        ev({
          id: 2,
          event_type: 'etapa_concluida',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          created_at: '2026-06-03T10:00:00Z',
        }),
      ]);
      const concluded = nodes.find((n) => n.key === 'event-2')!;
      expect(concluded.detail).toBe('2 dia(s) na etapa');
    });

    it('anchors on the nearest preceding event, not the first one chronologically (revert then reconclude)', () => {
      const nodes = buildWorkflowTimeline([
        ev({ id: 1, event_type: 'criado', created_at: '2026-06-01T10:00:00Z' }),
        ev({
          id: 2,
          event_type: 'etapa_iniciada',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          created_at: '2026-06-01T10:00:00Z',
        }),
        ev({
          id: 3,
          event_type: 'etapa_concluida',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          created_at: '2026-06-05T10:00:00Z',
        }),
        ev({
          id: 4,
          event_type: 'etapa_revertida',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          metadata: { voltou_de: 'Edição' },
          created_at: '2026-06-05T12:00:00Z',
        }),
        ev({
          id: 5,
          event_type: 'etapa_concluida',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          created_at: '2026-06-06T12:00:00Z',
        }),
      ]);
      const secondConclusion = nodes.find((n) => n.key === 'event-5')!;
      // Anchored on the etapa_revertida at id 4 (1 day later), not the
      // etapa_iniciada at id 2 (5 days later).
      expect(secondConclusion.detail).toBe('1 dia(s) na etapa');
    });

    it('renders "menos de 1 dia na etapa" for a same-day completion', () => {
      const nodes = buildWorkflowTimeline([
        ev({ id: 1, event_type: 'criado', created_at: '2026-06-01T10:00:00Z' }),
        ev({
          id: 2,
          event_type: 'etapa_iniciada',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          created_at: '2026-06-01T10:00:00Z',
        }),
        ev({
          id: 3,
          event_type: 'etapa_concluida',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          created_at: '2026-06-01T14:00:00Z',
        }),
      ]);
      const concluded = nodes.find((n) => n.key === 'event-3')!;
      expect(concluded.detail).toBe('menos de 1 dia na etapa');
    });

    it('is null only in the defensive case where even the criado event is absent from the slice', () => {
      const nodes = buildWorkflowTimeline([
        ev({
          id: 1,
          event_type: 'etapa_concluida',
          etapa_id: 100,
          etapa_nome: 'Roteiro',
          created_at: '2026-06-01T10:00:00Z',
        }),
      ]);
      expect(nodes[0].detail).toBeNull();
    });

    it('is null for every non-etapa_concluida event type', () => {
      const nodes = buildWorkflowTimeline([ev({ event_type: 'criado' })]);
      expect(nodes[0].detail).toBeNull();
    });
  });

  describe('actor labels', () => {
    it('shows the named workspace_user actor', () => {
      const [node] = buildWorkflowTimeline([ev({ source: 'workspace_user', actor_name: 'Bruno' })]);
      expect(node.actorLabel).toBe('Bruno');
    });

    it('shows — for a workspace_user actor with no name', () => {
      const [node] = buildWorkflowTimeline([ev({ source: 'workspace_user', actor_name: null })]);
      expect(node.actorLabel).toBe('—');
    });

    it('shows Sistema for source: system', () => {
      const [node] = buildWorkflowTimeline([ev({ source: 'system', actor_name: null })]);
      expect(node.actorLabel).toBe('Sistema');
    });

    it('shows Agente for a criado event with metadata.created_via === "agent", regardless of source', () => {
      // Deliberately source: 'workspace_user' — MCP/import-created workflows
      // resolve to that source via the DB trigger's user_id fallback, so the
      // actor label must key off created_via, never off source, to tell an
      // agent-created workflow apart from a human-created one.
      const [node] = buildWorkflowTimeline([
        ev({
          event_type: 'criado',
          source: 'workspace_user',
          actor_name: 'Bruno',
          metadata: { created_via: 'agent' },
        }),
      ]);
      expect(node.actorLabel).toBe('Agente');
    });
  });

  describe('tone mapping', () => {
    it('maps every event type to its documented tone', () => {
      const types: Array<[WorkflowEvent['event_type'], string]> = [
        ['criado', 'neutral'],
        ['etapa_iniciada', 'neutral'],
        ['etapa_editada', 'neutral'],
        ['fluxo_editado', 'neutral'],
        ['fluxo_arquivado', 'neutral'],
        ['template_migrado', 'neutral'],
        ['template_propagado', 'neutral'],
        ['etapa_concluida', 'approved'],
        ['etapa_revertida', 'correction'],
        ['fluxo_reaberto', 'correction'],
        ['fluxo_concluido', 'published'],
      ];
      for (const [event_type, tone] of types) {
        const [node] = buildWorkflowTimeline([ev({ event_type })]);
        expect(node.tone).toBe(tone);
      }
    });

    it('falls back to neutral for an unknown/future event type', () => {
      const [node] = buildWorkflowTimeline([
        ev({ event_type: 'evento_futuro' as unknown as WorkflowEvent['event_type'] }),
      ]);
      expect(node.tone).toBe('neutral');
    });
  });

  describe('diffs — tipo field (etapa client-approval gate)', () => {
    it('renders tipo as Padrão/Aprovação do cliente with the Portuguese field label', () => {
      const [node] = buildWorkflowTimeline([
        ev({
          event_type: 'etapa_editada',
          metadata: {
            changes: [{ field: 'tipo', from: 'padrao', to: 'aprovacao_cliente' }],
          },
        }),
      ]);
      expect(node.diffs).toEqual(['Tipo: Padrão → Aprovação do cliente']);
    });
  });
});
