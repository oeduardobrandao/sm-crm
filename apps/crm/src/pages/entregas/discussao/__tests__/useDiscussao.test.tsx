import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CommentThreadWithComments, PostComment } from '@/store/comments';

// A postgres_changes stand-in that knows about several tables per channel and keeps an
// ordered log of channel creation/removal (the shared supabase mock has no generic emit).
const h = vi.hoisted(() => {
  type Listener = {
    channel: object;
    table: string;
    filter: { event: string; schema: string; table: string; filter?: string };
    cb: () => void;
  };
  const state = {
    log: [] as string[],
    listeners: [] as Listener[],
    rpc: vi.fn(),
  };
  const supabase = {
    rpc: (name: string, params: Record<string, unknown>) => state.rpc(name, params),
    channel: (name: string) => {
      state.log.push(`create:${name}`);
      const pending: Listener[] = [];
      const channel: Record<string, unknown> = {
        name,
        on(_t: string, filter: Listener['filter'], cb: () => void) {
          pending.push({ channel, table: filter.table, filter, cb });
          return channel;
        },
        subscribe() {
          state.log.push(`subscribe:${name}`);
          state.listeners.push(...pending);
          return channel;
        },
      };
      return channel;
    },
    removeChannel: (ch: { name: string }) => {
      state.log.push(`remove:${ch.name}`);
      state.listeners = state.listeners.filter((l) => l.channel !== ch);
      return Promise.resolve('ok');
    },
  };
  return { state, supabase };
});

vi.mock('@/lib/supabase', () => ({ supabase: h.supabase }));

import { useDiscussao } from '../useDiscussao';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  disconnected = false;
  constructor(private cb: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  trigger(ratio: number) {
    this.cb(
      [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}
const liveObserver = () =>
  FakeIntersectionObserver.instances.filter((o) => !o.disconnected).at(-1) as
    | FakeIntersectionObserver
    | undefined;

const ME = 'me';
const OTHER = 'other';

function comment(id: number, threadId: number, author: string): PostComment {
  return {
    id,
    thread_id: threadId,
    author_id: author,
    content: `c${id}`,
    created_at: new Date(2026, 9, 22, 10, id).toISOString(),
    updated_at: null,
  };
}
function thread(id: number, comments: PostComment[]): CommentThreadWithComments {
  return {
    id,
    post_id: 1,
    conta_id: 'conta',
    quoted_text: '',
    status: 'active',
    created_by: OTHER,
    resolved_by: null,
    created_at: new Date(2026, 9, 22, 9).toISOString(),
    resolved_at: null,
    field: 'geral',
    anchor_start: null,
    anchor_end: null,
    orphaned: false,
    post_comments: comments,
  };
}

type RpcRow = { seguindo: boolean; last_seen_comment_id: number; implicito: boolean };
let participacaoRow: RpcRow;
const rpcCalls = (name: string) => h.state.rpc.mock.calls.filter((c) => c[0] === name);

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const THREADS = [
  thread(10, [comment(1, 10, OTHER), comment(2, 10, ME), comment(5, 10, OTHER)]),
  thread(20, [comment(7, 20, OTHER), comment(9, 20, OTHER)]),
];

function setup(
  props: { postId?: number; threads?: CommentThreadWithComments[] } = {},
  row: RpcRow = { seguindo: true, last_seen_comment_id: 2, implicito: false },
) {
  participacaoRow = row;
  return renderHook(
    (p: { postId: number; threads: CommentThreadWithComments[] }) =>
      useDiscussao({ postId: p.postId, threads: p.threads, currentUserId: ME }),
    {
      wrapper,
      initialProps: { postId: props.postId ?? 1, threads: props.threads ?? THREADS },
    },
  );
}

beforeEach(() => {
  h.state.log.length = 0;
  h.state.listeners = [];
  h.state.rpc.mockReset();
  h.state.rpc.mockImplementation(async (name: string) => {
    if (name === 'get_post_discussao_participacao') return { data: [participacaoRow], error: null };
    return { data: null, error: null };
  });
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useDiscussao realtime', () => {
  it('subscribes to threads by post and to comments by the sorted thread ids', () => {
    setup({ threads: [THREADS[1], THREADS[0]] });
    const filters = h.state.listeners.map((l) => [l.table, l.filter.filter]);
    expect(filters).toEqual([
      ['post_comment_threads', 'post_id=eq.1'],
      ['post_comments', 'thread_id=in.(10,20)'],
    ]);
    expect(h.state.log).toContain('create:post-discussao-1');
  });

  it('subscribes only to the threads table when the post has no threads', () => {
    setup({ threads: [] });
    expect(h.state.listeners.map((l) => l.table)).toEqual(['post_comment_threads']);
  });

  it('re-subscribes when the thread id set changes', () => {
    const { rerender } = setup({ threads: [THREADS[0]] });
    expect(h.state.listeners.at(-1)?.filter.filter).toBe('thread_id=in.(10)');
    rerender({ postId: 1, threads: THREADS });
    expect(h.state.listeners.at(-1)?.filter.filter).toBe('thread_id=in.(10,20)');
    expect(h.state.listeners.filter((l) => l.table === 'post_comments')).toHaveLength(1);
  });

  it('removes the previous post channel before creating the next one', () => {
    const { rerender } = setup({ postId: 1 });
    rerender({ postId: 2, threads: THREADS });
    const log = h.state.log.filter((e) => e.includes('post-discussao'));
    expect(log.indexOf('remove:post-discussao-1')).toBeGreaterThan(-1);
    expect(log.indexOf('remove:post-discussao-1')).toBeLessThan(
      log.indexOf('create:post-discussao-2'),
    );
    expect(
      h.state.listeners.every(
        (l) => l.filter.filter?.startsWith('post_id=eq.2') || l.table === 'post_comments',
      ),
    ).toBe(true);
    expect(h.state.listeners.find((l) => l.table === 'post_comment_threads')?.filter.filter).toBe(
      'post_id=eq.2',
    );
  });

  it('removes the channel on unmount', () => {
    const { unmount } = setup();
    unmount();
    expect(h.state.log).toContain('remove:post-discussao-1');
    expect(h.state.listeners).toHaveLength(0);
  });

  it('invalidates the threads and unread prefixes on every event', () => {
    setup();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    act(() => h.state.listeners.find((l) => l.table === 'post_comments')?.cb());
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-comment-threads'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-discussao-nao-lidas'] });
    spy.mockClear();
    act(() => h.state.listeners.find((l) => l.table === 'post_comment_threads')?.cb());
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-comment-threads'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-discussao-nao-lidas'] });
  });
});

describe('useDiscussao unread count', () => {
  it('counts others comments above the marker across all threads', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.participacao).toBeDefined());
    // marker 2: ids 5, 7, 9 are others' and above it; id 2 is mine and below
    expect(result.current.isParticipant).toBe(true);
    expect(result.current.naoLidas).toBe(3);
  });

  it('ignores my own comments above the marker', async () => {
    const { result } = setup(
      { threads: [thread(10, [comment(3, 10, ME), comment(4, 10, OTHER)])] },
      { seguindo: true, last_seen_comment_id: 0, implicito: false },
    );
    await waitFor(() => expect(result.current.participacao).toBeDefined());
    expect(result.current.naoLidas).toBe(1);
  });

  it('is 0 for a non-participant', async () => {
    const { result } = setup({}, { seguindo: false, last_seen_comment_id: 0, implicito: false });
    await waitFor(() => expect(result.current.participacao).toBeDefined());
    expect(result.current.isParticipant).toBe(false);
    expect(result.current.naoLidas).toBe(0);
    expect(result.current.unreadAnchorId).toBeNull();
  });

  it('treats the implicit responsible as a participant', async () => {
    const { result } = setup({}, { seguindo: false, last_seen_comment_id: 0, implicito: true });
    await waitFor(() => expect(result.current.isParticipant).toBe(true));
    expect(result.current.naoLidas).toBe(4);
  });
});

describe('useDiscussao read marker', () => {
  async function mount(row?: RpcRow) {
    const utils = setup({}, row);
    await waitFor(() => expect(utils.result.current.participacao).toBeDefined());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => utils.result.current.sectionRef(document.createElement('div')));
    return utils;
  }

  it('marks read once with the max id after 800 ms of visibility, and not again for the same id', async () => {
    const { rerender } = await mount();
    act(() => liveObserver()?.trigger(0.6));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(rpcCalls('post_discussao_marcar_lido')).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(rpcCalls('post_discussao_marcar_lido')).toEqual([
      ['post_discussao_marcar_lido', { p_post_id: 1, p_comment_id: 9 }],
    ]);
    rerender({ postId: 1, threads: [...THREADS] });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(rpcCalls('post_discussao_marcar_lido')).toHaveLength(1);
  });

  it('marks again when a newer comment arrives while visible', async () => {
    const { rerender } = await mount();
    act(() => liveObserver()?.trigger(1));
    await act(() => vi.advanceTimersByTimeAsync(900));
    const next = [THREADS[0], thread(20, [...THREADS[1].post_comments, comment(12, 20, OTHER)])];
    rerender({ postId: 1, threads: next });
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(rpcCalls('post_discussao_marcar_lido').map((c) => c[1].p_comment_id)).toEqual([9, 12]);
  });

  it('does not mark when less than half of the section is visible', async () => {
    await mount();
    act(() => liveObserver()?.trigger(0.3));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(rpcCalls('post_discussao_marcar_lido')).toHaveLength(0);
  });

  it('does not mark when the section leaves the screen before 800 ms', async () => {
    await mount();
    act(() => liveObserver()?.trigger(1));
    await act(() => vi.advanceTimersByTimeAsync(400));
    act(() => liveObserver()?.trigger(0));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(rpcCalls('post_discussao_marcar_lido')).toHaveLength(0);
  });

  it('never marks for a non-participant', async () => {
    await mount({ seguindo: false, last_seen_comment_id: 0, implicito: false });
    act(() => liveObserver()?.trigger(1));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(rpcCalls('post_discussao_marcar_lido')).toHaveLength(0);
  });

  it('keeps unreadAnchorId at the marker it had on load after marking read', async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.unreadAnchorId).toBe(2));
    act(() => liveObserver()?.trigger(1));
    // the server moves the marker; the refetch after marking returns the new value
    participacaoRow = { seguindo: true, last_seen_comment_id: 9, implicito: false };
    await act(() => vi.advanceTimersByTimeAsync(900));
    await waitFor(() => expect(result.current.participacao?.lastSeenCommentId).toBe(9));
    expect(result.current.unreadAnchorId).toBe(2);
    expect(result.current.naoLidas).toBe(0);
  });

  it('invalidates participation and unread prefixes after marking', async () => {
    await mount();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    act(() => liveObserver()?.trigger(1));
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-discussao-participacao', 1] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-discussao-nao-lidas'] });
  });
});

describe('useDiscussao mutations', () => {
  it('send posts to the general thread and invalidates threads and unread', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.participacao).toBeDefined());
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await act(() => result.current.send('oi time'));
    expect(rpcCalls('post_discussao_enviar')).toEqual([
      ['post_discussao_enviar', { p_post_id: 1, p_content: 'oi time', p_thread_id: null }],
    ]);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-comment-threads'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-discussao-nao-lidas'] });
    expect(result.current.sending).toBe(false);
  });

  it('send rejects and leaves sending false when the RPC errors', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.participacao).toBeDefined());
    h.state.rpc.mockImplementation(async (name: string) =>
      name === 'post_discussao_enviar'
        ? { data: null, error: new Error('rls') }
        : { data: [participacaoRow], error: null },
    );
    const spy = vi.spyOn(qc, 'invalidateQueries');
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.send('oi');
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBeInstanceOf(Error);
    expect(result.current.sending).toBe(false);
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['post-comment-threads'] });
  });

  it('sending is true while the RPC is in flight', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.participacao).toBeDefined());
    let release: (v: unknown) => void = () => {};
    h.state.rpc.mockImplementation(
      (name: string) =>
        new Promise((resolve) => {
          if (name === 'post_discussao_enviar') release = resolve;
          else resolve({ data: [participacaoRow], error: null });
        }),
    );
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.send('oi');
    });
    await waitFor(() => expect(result.current.sending).toBe(true));
    await act(async () => {
      release({ data: null, error: null });
      await pending;
    });
    await waitFor(() => expect(result.current.sending).toBe(false));
  });

  it('toggleSeguir calls setDiscussaoSeguindo with the opposite of the current state', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.participacao?.seguindo).toBe(true));
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await act(() => result.current.toggleSeguir());
    expect(rpcCalls('post_discussao_seguir')).toEqual([
      ['post_discussao_seguir', { p_post_id: 1, p_seguir: false }],
    ]);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-discussao-participacao', 1] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['post-discussao-nao-lidas'] });
  });

  it('toggleSeguir follows when not following', async () => {
    const { result } = setup({}, { seguindo: false, last_seen_comment_id: 0, implicito: false });
    await waitFor(() => expect(result.current.participacao).toBeDefined());
    await act(() => result.current.toggleSeguir());
    expect(rpcCalls('post_discussao_seguir')[0][1]).toEqual({ p_post_id: 1, p_seguir: true });
  });
});
