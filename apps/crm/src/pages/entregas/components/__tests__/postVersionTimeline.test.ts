import { describe, it, expect } from 'vitest';
import { buildVersionTimeline, findPrecedingVersion } from '../postVersionTimeline';
import type { PostApproval, PostContentVersion, PostStatusEvent } from '../../../../store';

function version(partial: Partial<PostContentVersion>): PostContentVersion {
  return {
    id: 1,
    post_id: 10,
    conteudo: null,
    conteudo_plain: 'v',
    ig_caption: null,
    tiktok_caption: null,
    changed_fields: ['conteudo_plain'],
    source: 'workspace_user',
    actor_user_id: null,
    actor_name: 'Ana',
    suggestion_id: null,
    created_at: '2026-06-01T10:00:00Z',
    last_touched_at: '2026-06-01T10:00:00Z',
    ...partial,
  };
}

function ev(partial: Partial<PostStatusEvent>): PostStatusEvent {
  return {
    id: 1,
    post_id: 10,
    from_status: null,
    to_status: 'enviado_cliente',
    source: 'workspace_user',
    actor_user_id: null,
    actor_name: null,
    post_approval_id: null,
    from_custom_status_id: null,
    to_custom_status_id: null,
    from_custom_nome: null,
    to_custom_nome: null,
    created_at: '2026-06-02T10:00:00Z',
    ...partial,
  };
}

describe('buildVersionTimeline', () => {
  it('attaches the client comment to a correcao_cliente node via post_approval_id', () => {
    const approvals = [
      {
        id: 99,
        post_id: 10,
        token: 't',
        action: 'correcao',
        comentario: 'Ajusta o texto',
        is_workspace_user: false,
        created_at: '2026-06-03T10:00:00Z',
      },
    ] as PostApproval[];

    const nodes = buildVersionTimeline(
      [],
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

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: 'status',
      label: 'Correção solicitada',
      actorLabel: 'Cliente',
      comment: 'Ajusta o texto',
    });
  });

  it('filters out status events that are not visible to the client', () => {
    const nodes = buildVersionTimeline(
      [],
      [
        ev({ id: 1, to_status: 'revisao_interna' }), // internal-only, must be dropped
        ev({ id: 2, to_status: 'aprovado_cliente' }), // client-facing, must be kept
      ],
      [],
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'status', label: 'Aprovado pelo cliente' });
  });

  it('at equal timestamps, sorts the version node before the status node', () => {
    const sameInstant = '2026-06-05T12:00:00Z';
    const nodes = buildVersionTimeline(
      [version({ id: 5, last_touched_at: sameInstant, created_at: sameInstant })],
      [ev({ id: 5, to_status: 'aprovado_cliente', created_at: sameInstant })],
      [],
    );
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.kind)).toEqual(['version', 'status']);
  });

  it('exercises the approvals prop wiring end-to-end (fails if approvals is dropped)', () => {
    const approvals = [
      {
        id: 1,
        post_id: 10,
        token: 't',
        action: 'correcao',
        comentario: 'Sem essa cor',
        is_workspace_user: false,
        created_at: '2026-06-01T00:00:00Z',
      },
    ] as PostApproval[];
    const [node] = buildVersionTimeline(
      [],
      [ev({ to_status: 'correcao_cliente', post_approval_id: 1 })],
      approvals,
    );
    expect(node.kind === 'status' && node.comment).toBe('Sem essa cor');
  });

  it('shows a range when created_at differs from last_touched_at, null otherwise', () => {
    const [single] = buildVersionTimeline(
      [
        version({
          id: 1,
          created_at: '2026-06-01T10:00:00Z',
          last_touched_at: '2026-06-01T10:00:00Z',
        }),
      ],
      [],
      [],
    );
    expect(single.kind === 'version' && single.rangeStart).toBeNull();

    const [coalesced] = buildVersionTimeline(
      [
        version({
          id: 2,
          created_at: '2026-06-01T10:00:00Z',
          last_touched_at: '2026-06-01T10:04:00Z',
        }),
      ],
      [],
      [],
    );
    expect(coalesced.kind === 'version' && coalesced.rangeStart).toBe('2026-06-01T10:00:00Z');
  });
});

describe('findPrecedingVersion', () => {
  it('skips status nodes and returns null for the first version', () => {
    const nodes = buildVersionTimeline(
      [
        version({
          id: 1,
          last_touched_at: '2026-06-01T10:00:00Z',
          created_at: '2026-06-01T10:00:00Z',
        }),
        version({
          id: 2,
          last_touched_at: '2026-06-03T10:00:00Z',
          created_at: '2026-06-03T10:00:00Z',
        }),
      ],
      [ev({ id: 1, to_status: 'enviado_cliente', created_at: '2026-06-02T10:00:00Z' })],
      [],
    );
    const [first, , second] = nodes;
    expect(first.kind).toBe('version');
    expect(second.kind).toBe('version');

    expect(
      findPrecedingVersion(nodes, first as Extract<(typeof nodes)[number], { kind: 'version' }>),
    ).toBeNull();
    expect(
      findPrecedingVersion(nodes, second as Extract<(typeof nodes)[number], { kind: 'version' }>)
        ?.id,
    ).toBe(1);
  });
});
