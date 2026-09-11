import { describe, it, expect } from 'vitest';
import { buildPostTimeline, processEventLabel } from '../postTimeline';
import type { PostStatusEvent, PostApproval, PostProcessEvent } from '../../../../store';

const post = { created_at: '2026-06-01T10:00:00Z' };

function ev(partial: Partial<PostStatusEvent>): PostStatusEvent {
  return {
    id: 1,
    post_id: 10,
    from_status: null,
    to_status: 'revisao_interna',
    source: 'workspace_user',
    actor_user_id: null,
    actor_name: null,
    post_approval_id: null,
    created_at: '2026-06-02T10:00:00Z',
    ...partial,
  };
}

describe('buildPostTimeline', () => {
  it('always starts with a "Criado" node from created_at, even with no events', () => {
    const nodes = buildPostTimeline(post, [], []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: 'created',
      label: 'Criado',
      at: post.created_at,
      tone: 'neutral',
    });
  });

  it('orders nodes by time, mapping status labels and tones', () => {
    const nodes = buildPostTimeline(
      post,
      [
        ev({ id: 2, to_status: 'postado', created_at: '2026-06-05T10:00:00Z' }),
        ev({ id: 1, to_status: 'revisao_interna', created_at: '2026-06-02T10:00:00Z' }),
      ],
      [],
    );
    expect(nodes.map((n) => n.label)).toEqual(['Criado', 'Em revisão', 'Postado']);
    expect(nodes[2].tone).toBe('published');
  });

  it('labels the actor from source (workspace name, Cliente, Sistema, or —)', () => {
    const [, wsNamed] = buildPostTimeline(
      post,
      [ev({ source: 'workspace_user', actor_name: 'Bruno' })],
      [],
    );
    expect(wsNamed.actorLabel).toBe('Bruno');
    const [, wsNoName] = buildPostTimeline(
      post,
      [ev({ source: 'workspace_user', actor_name: null })],
      [],
    );
    expect(wsNoName.actorLabel).toBe('—');
    const [, client] = buildPostTimeline(
      post,
      [ev({ source: 'client', to_status: 'aprovado_cliente' })],
      [],
    );
    expect(client.actorLabel).toBe('Cliente');
    const [, system] = buildPostTimeline(
      post,
      [ev({ source: 'system', to_status: 'postado' })],
      [],
    );
    expect(system.actorLabel).toBe('Sistema');
  });

  it('attaches the client comment via post_approval_id', () => {
    const approvals = [
      {
        id: 99,
        post_id: 10,
        token: 't',
        action: 'correcao',
        comentario: 'Ajuste o título',
        is_workspace_user: false,
        created_at: '2026-06-03T10:00:00Z',
      },
    ] as PostApproval[];
    const [, node] = buildPostTimeline(
      post,
      [
        ev({
          to_status: 'correcao_cliente',
          source: 'client',
          post_approval_id: 99,
          created_at: '2026-06-03T10:00:00Z',
        }),
      ],
      approvals,
    );
    expect(node.label).toBe('Correção solicitada');
    expect(node.tone).toBe('correction');
    expect(node.comment).toBe('Ajuste o título');
  });
});

function pev(partial: Partial<PostProcessEvent>): PostProcessEvent {
  return {
    id: 1,
    conta_id: 'c',
    post_id: 10,
    process_id: 5,
    evento: 'aplicado',
    actor_user_id: null,
    actor_name: 'Ana',
    origem: 'workspace_user',
    antes: null,
    depois: null,
    created_at: '2026-06-03T10:00:00Z',
    ...partial,
  };
}

describe('buildPostTimeline com eventos de processo', () => {
  it('mescla a terceira fonte na mesma ordem temporal, com kind process', () => {
    const nodes = buildPostTimeline(
      post,
      [ev({ id: 1, to_status: 'revisao_interna', created_at: '2026-06-02T10:00:00Z' })],
      [],
      [
        pev({
          id: 7,
          evento: 'avancou',
          depois: { etapa_nome: 'Design' },
          created_at: '2026-06-02T12:00:00Z',
        }),
      ],
    );
    expect(nodes.map((n) => [n.kind, n.label])).toEqual([
      ['created', 'Criado'],
      ['status', 'Em revisão'],
      ['process', 'Avançou para Design'],
    ]);
    expect(nodes[2]).toMatchObject({ key: 'process-7', actorLabel: 'Ana', tone: 'neutral' });
  });

  it('rotula cada evento a partir do payload; origem system vira Sistema', () => {
    expect(
      processEventLabel(
        pev({
          evento: 'desmembrado',
          antes: { workflow_titulo: 'Setembro', etapa_nome: 'Design' },
        }),
      ),
    ).toBe('Desmembrado de Setembro na etapa Design');
    expect(processEventLabel(pev({ evento: 'aplicado', depois: { template_nome: 'Redes' } }))).toBe(
      'Processo aplicado: Redes',
    );
    expect(processEventLabel(pev({ evento: 'voltou', depois: { etapa_nome: 'Copy' } }))).toBe(
      'Voltou para Copy',
    );
    expect(processEventLabel(pev({ evento: 'concluido' }))).toBe('Processo concluído');
    expect(processEventLabel(pev({ evento: 'reaberto' }))).toBe('Processo reaberto');
    expect(processEventLabel(pev({ evento: 'removido' }))).toBe('Processo removido');
    expect(processEventLabel(pev({ evento: 'vinculado' }))).toBe(
      'Vinculado a um fluxo, processo encerrado',
    );
    expect(processEventLabel(pev({ evento: 'etapa_editada', depois: { nome: 'Design' } }))).toBe(
      'Etapa Design editada',
    );
    const sys = buildPostTimeline(
      { created_at: undefined },
      [],
      [],
      [pev({ origem: 'system', actor_name: null })],
    );
    expect(sys[0].actorLabel).toBe('Sistema');
    expect(
      buildPostTimeline({ created_at: undefined }, [], [], [pev({ evento: 'concluido' })])[0].tone,
    ).toBe('approved');
  });
});
