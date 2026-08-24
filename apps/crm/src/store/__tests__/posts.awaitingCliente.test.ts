import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock('../core', () => ({
  supabase: { from: mockFrom },
  getContaId: vi.fn(),
  getUserId: vi.fn(),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));
vi.mock('../mentions', () => ({ syncMentions: vi.fn() }));
vi.mock('@/components/mentions/mentionTokens', () => ({ extractMentionsFromDoc: () => [] }));

import { getAwaitingClientePosts } from '../posts';

/** Thenable query builder: every filter returns itself, awaiting resolves `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const m of ['select', 'eq', 'in', 'not', 'gte', 'lt', 'order']) q[m] = vi.fn(self);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return q;
}

describe('getAwaitingClientePosts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns [] without querying events when no post is enviado_cliente', async () => {
    mockFrom.mockReturnValueOnce(chain({ data: [], error: null }));
    expect(await getAwaitingClientePosts()).toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('attaches the LATEST enviado_cliente transition per post, null when none', async () => {
    const posts = chain({
      data: [
        {
          id: 1,
          workflow_id: 9,
          titulo: 'A',
          status: 'enviado_cliente',
          workflows: { titulo: 'W' },
        },
        {
          id: 2,
          workflow_id: 9,
          titulo: 'B',
          status: 'enviado_cliente',
          workflows: { titulo: 'W' },
        },
      ],
      error: null,
    });
    // Ordered created_at DESC by the query; the first row per post is the latest.
    const events = chain({
      data: [
        { post_id: 1, created_at: '2026-08-15T10:00:00Z' },
        { post_id: 1, created_at: '2026-08-01T10:00:00Z' },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(posts).mockReturnValueOnce(events);

    const rows = await getAwaitingClientePosts();
    expect(mockFrom).toHaveBeenNthCalledWith(1, 'workflow_posts');
    expect(mockFrom).toHaveBeenNthCalledWith(2, 'post_status_events');
    expect(events.eq).toHaveBeenCalledWith('to_status', 'enviado_cliente');
    expect(events.in).toHaveBeenCalledWith('post_id', [1, 2]);
    expect(rows.map((r) => [r.id, r.waiting_since])).toEqual([
      [1, '2026-08-15T10:00:00Z'],
      [2, null],
    ]);
  });
});
