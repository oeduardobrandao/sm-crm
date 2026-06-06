import { describe, it, expect } from 'vitest';
import { buildPostTimeline } from '../postTimeline';
import type { PostStatusEvent, PostApproval } from '../../../../store';

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
