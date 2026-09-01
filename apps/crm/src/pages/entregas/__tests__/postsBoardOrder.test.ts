import { describe, expect, it } from 'vitest';
import type { ActivePost } from '@/store';
import { BOARD_ORDEM_STEP, planBoardPlacement, sortColumnPosts } from '../postsBoardOrder';

function post(id: number, over: Partial<ActivePost> = {}): ActivePost {
  return {
    id,
    workflow_id: 10,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: 'Fluxo',
    titulo: `Post ${id}`,
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
    board_ordem: null,
    ...over,
  };
}

describe('sortColumnPosts', () => {
  it('manual: ranked posts first by board_ordem, unranked tail keeps auto order', () => {
    const posts = [
      post(1),
      post(2, { board_ordem: 2048 }),
      post(3, { scheduled_at: '2026-09-01T10:00:00Z' }),
      post(4, { board_ordem: 1024 }),
    ];
    expect(sortColumnPosts(posts, 'manual').map((p) => p.id)).toEqual([4, 2, 3, 1]);
  });

  it('data: scheduled asc nulls last, tie by id', () => {
    const posts = [
      post(5),
      post(2, { scheduled_at: '2026-09-02T10:00:00Z' }),
      post(9, { scheduled_at: '2026-09-01T10:00:00Z' }),
      post(1),
    ];
    expect(sortColumnPosts(posts, 'data').map((p) => p.id)).toEqual([9, 2, 1, 5]);
  });

  it('recentes: id desc; antigos: id asc', () => {
    const posts = [post(2), post(9), post(5)];
    expect(sortColumnPosts(posts, 'recentes').map((p) => p.id)).toEqual([9, 5, 2]);
    expect(sortColumnPosts(posts, 'antigos').map((p) => p.id)).toEqual([2, 5, 9]);
  });

  it('does not mutate the input array', () => {
    const posts = [post(2), post(1)];
    sortColumnPosts(posts, 'antigos');
    expect(posts.map((p) => p.id)).toEqual([2, 1]);
  });
});

describe('planBoardPlacement', () => {
  it('empty column: single seed rank', () => {
    expect(planBoardPlacement([], 0, 7)).toEqual([{ id: 7, board_ordem: BOARD_ORDEM_STEP }]);
  });

  it('drop at top above a ranked head: rank head - STEP', () => {
    const col = [post(1, { board_ordem: 1024 }), post(2, { board_ordem: 2048 })];
    expect(planBoardPlacement(col, 0, 7)).toEqual([{ id: 7, board_ordem: 0 }]);
  });

  it('drop at bottom below a ranked tail: rank tail + STEP', () => {
    const col = [post(1, { board_ordem: 1024 })];
    expect(planBoardPlacement(col, 1, 7)).toEqual([
      { id: 7, board_ordem: 1024 + BOARD_ORDEM_STEP },
    ]);
  });

  it('drop between two ranked neighbors: midpoint', () => {
    const col = [post(1, { board_ordem: 1024 }), post(2, { board_ordem: 2048 })];
    expect(planBoardPlacement(col, 1, 7)).toEqual([{ id: 7, board_ordem: 1536 }]);
  });

  it('unranked neighbor: materializes the whole column with the dragged post inserted', () => {
    const col = [post(1, { board_ordem: 1024 }), post(2)];
    expect(planBoardPlacement(col, 1, 7)).toEqual([
      { id: 1, board_ordem: 1024 },
      { id: 7, board_ordem: 2048 },
      { id: 2, board_ordem: 3072 },
    ]);
  });

  it('equal neighbor ranks (degenerate): materializes', () => {
    const col = [post(1, { board_ordem: 5 }), post(2, { board_ordem: 5 })];
    const updates = planBoardPlacement(col, 1, 7);
    expect(updates.map((u) => u.id)).toEqual([1, 7, 2]);
    expect(updates.map((u) => u.board_ordem)).toEqual([1024, 2048, 3072]);
  });
});
