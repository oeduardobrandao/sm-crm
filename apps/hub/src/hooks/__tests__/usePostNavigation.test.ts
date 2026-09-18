import { describe, expect, it } from 'vitest';
import { computePostNavigation } from '../usePostNavigation';
import type { HubPost } from '../../types';

function p(id: number, status: HubPost['status'] = 'enviado_cliente'): HubPost {
  return {
    id,
    titulo: `P${id}`,
    tipo: 'feed',
    status,
    ordem: id,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
  };
}

describe('computePostNavigation', () => {
  const posts = [p(1), p(2, 'aprovado_cliente'), p(3), p(4, 'postado')];

  it('finds prev/next by array order, null at the ends', () => {
    expect(computePostNavigation(posts, 1)).toMatchObject({ index: 0, prev: null, next: posts[1] });
    expect(computePostNavigation(posts, 4)).toMatchObject({ index: 3, prev: posts[2], next: null });
  });

  it('nextPending skips non-pending posts and wraps around', () => {
    expect(computePostNavigation(posts, 1).nextPending?.id).toBe(3);
    expect(computePostNavigation(posts, 3).nextPending?.id).toBe(1);
  });

  it('nextPending is null when the current post is the only pending one', () => {
    expect(computePostNavigation([p(1), p(2, 'postado')], 1).nextPending).toBeNull();
  });

  it('returns index -1 and nulls for an unknown id', () => {
    expect(computePostNavigation(posts, 99)).toEqual({
      index: -1,
      current: null,
      prev: null,
      next: null,
      nextPending: null,
    });
    expect(computePostNavigation(posts, null).index).toBe(-1);
  });
});
