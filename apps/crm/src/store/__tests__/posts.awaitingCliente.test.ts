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
  for (const m of ['select', 'eq', 'in', 'not', 'gte', 'lt', 'order', 'is']) q[m] = vi.fn(self);
  q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return q;
}

describe('getAwaitingClientePosts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns [] without querying events when no post is enviado_cliente (wired or avulso)', async () => {
    // Two-query merge (Promise.all): wired arm first, avulso arm second.
    mockFrom
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }));
    expect(await getAwaitingClientePosts()).toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(mockFrom).toHaveBeenNthCalledWith(1, 'workflow_posts');
    expect(mockFrom).toHaveBeenNthCalledWith(2, 'workflow_posts');
  });

  it('attaches the LATEST enviado_cliente transition per post, null when none, across wired + avulso posts', async () => {
    const wiredPosts = chain({
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
    const avulsoPosts = chain({
      data: [
        {
          id: 3,
          workflow_id: null,
          cliente_id: 5,
          titulo: 'C',
          status: 'enviado_cliente',
          clientes: { nome: 'Beto' },
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
    mockFrom
      .mockReturnValueOnce(wiredPosts)
      .mockReturnValueOnce(avulsoPosts)
      .mockReturnValueOnce(events);

    const rows = await getAwaitingClientePosts();
    expect(mockFrom).toHaveBeenNthCalledWith(1, 'workflow_posts');
    expect(mockFrom).toHaveBeenNthCalledWith(2, 'workflow_posts');
    expect(mockFrom).toHaveBeenNthCalledWith(3, 'post_status_events');
    expect(avulsoPosts.is).toHaveBeenCalledWith('workflow_id', null);
    expect(events.eq).toHaveBeenCalledWith('to_status', 'enviado_cliente');
    expect(events.in).toHaveBeenCalledWith('post_id', [1, 2, 3]);
    expect(rows.map((r) => [r.id, r.workflow_id, r.waiting_since])).toEqual([
      [1, 9, '2026-08-15T10:00:00Z'],
      [2, 9, null],
      [3, null, null],
    ]);
    expect(rows[2]).toMatchObject({ cliente_nome: 'Beto', workflow_titulo: null });
  });
});
