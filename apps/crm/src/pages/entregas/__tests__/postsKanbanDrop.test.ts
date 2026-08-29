import { describe, expect, it } from 'vitest';
import type { ActivePost, PostStatusDefinition } from '../../../store';
import { buildStatusRegistry, customKey } from '../statusRegistry';
import { COL_PREFIX, resolvePostsKanbanDrop } from '../postsKanbanDrop';

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
