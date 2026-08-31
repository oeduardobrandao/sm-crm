import { describe, expect, it } from 'vitest';
import type { ActivePost, PostStatusDefinition } from '../../../store';
import { buildStatusRegistry, customKey } from '../statusRegistry';
import {
  COL_PREFIX,
  buildUndoableStatusMove,
  resolvePostsKanbanDrop,
  resolvePostsKanbanHover,
} from '../postsKanbanDrop';

const UUID = '11111111-2222-3333-4444-555555555555';

function def(overrides: Partial<PostStatusDefinition> = {}): PostStatusDefinition {
  return {
    id: UUID,
    conta_id: 'conta-1',
    nome: 'Em design',
    cor: '#7c5cff',
    behaves_as: 'rascunho',
    ordem: 0,
    arquivado: false,
    created_at: '2026-08-05T00:00:00Z',
    updated_at: '2026-08-05T00:00:00Z',
    ...overrides,
  };
}

function makePost(overrides: Partial<ActivePost> = {}): ActivePost {
  return {
    id: 1,
    workflow_id: 10,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: 'Fluxo Base',
    titulo: 'Post',
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    ...overrides,
  };
}

describe('resolvePostsKanbanDrop', () => {
  const registry = buildStatusRegistry([]);

  it('is a no-op when there is no post or no drop target', () => {
    expect(
      resolvePostsKanbanDrop({ post: undefined, overId: `${COL_PREFIX}rascunho`, registry }),
    ).toEqual({ kind: 'noop' });
    expect(resolvePostsKanbanDrop({ post: makePost(), overId: undefined, registry })).toEqual({
      kind: 'noop',
    });
  });

  it('is a no-op when dropped outside a column (e.g. onto another card)', () => {
    expect(resolvePostsKanbanDrop({ post: makePost(), overId: '999', registry })).toEqual({
      kind: 'noop',
    });
  });

  it('is a no-op for a locked source post regardless of target', () => {
    const post = makePost({ status: 'postado' });
    expect(resolvePostsKanbanDrop({ post, overId: `${COL_PREFIX}rascunho`, registry })).toEqual({
      kind: 'noop',
    });
  });

  it("is a no-op when the drop target is the post's own column", () => {
    const post = makePost({ status: 'rascunho' });
    expect(resolvePostsKanbanDrop({ post, overId: `${COL_PREFIX}rascunho`, registry })).toEqual({
      kind: 'noop',
    });
  });

  it('rejects an unknown target key', () => {
    const post = makePost({ status: 'rascunho' });
    expect(resolvePostsKanbanDrop({ post, overId: `${COL_PREFIX}nao_existe`, registry })).toEqual({
      kind: 'invalid',
    });
  });

  it('rejects a drop onto a system (locked) column, carrying its tooltip as the message', () => {
    const post = makePost({ status: 'rascunho' });
    expect(resolvePostsKanbanDrop({ post, overId: `${COL_PREFIX}agendado`, registry })).toEqual({
      kind: 'locked-column',
      message: 'Post já agendado no Instagram — cancele o agendamento para mover',
    });
  });

  it('asks for confirmation when moving an approved post to a different canonical status', () => {
    const post = makePost({ status: 'aprovado_interno' });
    expect(resolvePostsKanbanDrop({ post, overId: `${COL_PREFIX}rascunho`, registry })).toEqual({
      kind: 'confirm',
      key: 'rascunho',
    });
  });

  it('writes a plain canonical move for an unapproved post', () => {
    const post = makePost({ status: 'rascunho' });
    expect(
      resolvePostsKanbanDrop({ post, overId: `${COL_PREFIX}revisao_interna`, registry }),
    ).toEqual({ kind: 'write', key: 'revisao_interna' });
  });

  it('writes a custom-status move (statusKeyToPatch sends only the pointer)', () => {
    const customRegistry = buildStatusRegistry([def({ behaves_as: 'revisao_interna' })]);
    const post = makePost({ status: 'rascunho' });
    expect(
      resolvePostsKanbanDrop({
        post,
        overId: `${COL_PREFIX}${customKey(UUID)}`,
        registry: customRegistry,
      }),
    ).toEqual({ kind: 'write', key: customKey(UUID) });
  });

  it('moving an approved post into a custom status with the same canonical needs no confirmation', () => {
    const customRegistry = buildStatusRegistry([def({ behaves_as: 'aprovado_interno' })]);
    const post = makePost({ status: 'aprovado_interno' });
    expect(
      resolvePostsKanbanDrop({
        post,
        overId: `${COL_PREFIX}${customKey(UUID)}`,
        registry: customRegistry,
      }),
    ).toEqual({ kind: 'write', key: customKey(UUID) });
  });
});

describe('resolvePostsKanbanHover', () => {
  const registry = buildStatusRegistry([]);

  it('returns null without a post, without an over target, or over a non-column id', () => {
    const posts = [makePost()];
    expect(
      resolvePostsKanbanHover({
        post: undefined,
        posts,
        overId: `${COL_PREFIX}revisao_interna`,
        registry,
      }),
    ).toBeNull();
    expect(
      resolvePostsKanbanHover({ post: posts[0], posts, overId: undefined, registry }),
    ).toBeNull();
    expect(resolvePostsKanbanHover({ post: posts[0], posts, overId: '42', registry })).toBeNull();
  });

  it('returns null over the post’s own column and over unknown or locked columns', () => {
    const post = makePost();
    const posts = [post];
    expect(
      resolvePostsKanbanHover({ post, posts, overId: `${COL_PREFIX}rascunho`, registry }),
    ).toBeNull();
    expect(
      resolvePostsKanbanHover({ post, posts, overId: `${COL_PREFIX}nao_existe`, registry }),
    ).toBeNull();
    expect(
      resolvePostsKanbanHover({ post, posts, overId: `${COL_PREFIX}agendado`, registry }),
    ).toBeNull();
    expect(
      resolvePostsKanbanHover({ post, posts, overId: `${COL_PREFIX}postado`, registry }),
    ).toBeNull();
  });

  it('returns null when the dragged post itself sits in a locked status', () => {
    const post = makePost({ status: 'postado' });
    expect(
      resolvePostsKanbanHover({
        post,
        posts: [post],
        overId: `${COL_PREFIX}rascunho`,
        registry,
      }),
    ).toBeNull();
  });

  it('opens the slot at the true landing index of the target column', () => {
    // Board order: r1, r2 (revisao_interna), dragged (rascunho), r3 (revisao_interna).
    // Landing index in revisao_interna = 2 (r1 and r2 precede the dragged post).
    const dragged = makePost({ id: 10 });
    const posts = [
      makePost({ id: 1, status: 'revisao_interna' }),
      makePost({ id: 2, status: 'revisao_interna' }),
      dragged,
      makePost({ id: 3, status: 'revisao_interna' }),
    ];
    expect(
      resolvePostsKanbanHover({
        post: dragged,
        posts,
        overId: `${COL_PREFIX}revisao_interna`,
        registry,
      }),
    ).toEqual({ key: 'revisao_interna', index: 2 });
  });

  it('opens the slot at index 0 for an empty target column', () => {
    const dragged = makePost({ id: 10 });
    expect(
      resolvePostsKanbanHover({
        post: dragged,
        posts: [dragged],
        overId: `${COL_PREFIX}enviado_cliente`,
        registry,
      }),
    ).toEqual({ key: 'enviado_cliente', index: 0 });
  });

  it('groups by resolved key, so custom-status posts count in their own column, not the canonical one', () => {
    const customRegistry = buildStatusRegistry([def()]);
    const key = customKey(UUID);
    const dragged = makePost({ id: 10, status: 'revisao_interna' });
    const posts = [
      // Custom "Em design" behaves as rascunho but lives in its own column.
      makePost({ id: 1, custom_status_id: UUID, status: 'rascunho' }),
      makePost({ id: 2, status: 'rascunho' }),
      dragged,
    ];
    // Hovering the plain rascunho column: only post 2 belongs to it.
    expect(
      resolvePostsKanbanHover({
        post: dragged,
        posts,
        overId: `${COL_PREFIX}rascunho`,
        registry: customRegistry,
      }),
    ).toEqual({ key: 'rascunho', index: 1 });
    // Hovering the custom column: only post 1 belongs to it.
    expect(
      resolvePostsKanbanHover({
        post: dragged,
        posts,
        overId: `${COL_PREFIX}${key}`,
        registry: customRegistry,
      }),
    ).toEqual({ key, index: 1 });
  });
});

describe('buildUndoableStatusMove', () => {
  const registry = buildStatusRegistry([]);

  it('captures forward and backward vars for a canonical-to-canonical move', () => {
    const post = makePost({ id: 7, workflow_id: 33, status: 'rascunho' });
    expect(buildUndoableStatusMove({ post, key: 'revisao_interna', registry })).toEqual({
      forward: { id: 7, workflowId: 33, key: 'revisao_interna', canonical: 'revisao_interna' },
      backward: { id: 7, workflowId: 33, key: 'rascunho', canonical: 'rascunho' },
      targetLabel: 'Em revisão',
    });
  });

  it('round-trips a custom status: backward restores the custom pointer, not the canonical', () => {
    const customRegistry = buildStatusRegistry([def()]);
    const key = customKey(UUID);
    const post = makePost({ id: 7, workflow_id: null, custom_status_id: UUID, status: 'rascunho' });
    const move = buildUndoableStatusMove({
      post,
      key: 'enviado_cliente',
      registry: customRegistry,
    });
    expect(move).toEqual({
      forward: { id: 7, workflowId: null, key: 'enviado_cliente', canonical: 'enviado_cliente' },
      backward: { id: 7, workflowId: null, key, canonical: 'rascunho' },
      targetLabel: 'Enviado ao cliente',
    });
  });

  it('targets a custom column with its behaves_as canonical in the forward patch', () => {
    const customRegistry = buildStatusRegistry([def()]);
    const key = customKey(UUID);
    const post = makePost({ id: 7, status: 'revisao_interna' });
    const move = buildUndoableStatusMove({ post, key, registry: customRegistry });
    expect(move?.forward).toEqual({ id: 7, workflowId: 10, key, canonical: 'rascunho' });
    expect(move?.targetLabel).toBe('Em design');
  });

  it('returns null for an unknown target key', () => {
    expect(
      buildUndoableStatusMove({ post: makePost(), key: 'custom:nope' as never, registry }),
    ).toBeNull();
  });
});
