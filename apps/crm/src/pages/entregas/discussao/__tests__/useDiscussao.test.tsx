import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CommentThreadWithComments, PostComment } from '@/store/comments';

// A postgres_changes stand-in that knows about several tables per channel and keeps an
// ordered log of channel creation/removal (the shared supabase mock has no generic emit).
// Like realtime-js 2.x, `channel(topic)` hands back the channel already registered under
// that topic, a removed channel stays registered (state "leaving") until the leave ack
// arrives on a later tick, and `subscribe()` only joins a "closed" channel.
const h = vi.hoisted(() => {
  type Listener = {
    channel: object;
    table: string;
    filter: { event: string; schema: string; table: string; filter?: string };
    cb: () => void;
  };
  type FakeChannel = {
    name: string;
    state: 'closed' | 'joined' | 'leaving';
    on: (t: string, filter: Listener['filter'], cb: () => void) => FakeChannel;
    subscribe: () => FakeChannel;
  };
  const state = {
    log: [] as string[],
    listeners: [] as Listener[],
    topics: new Map<string, FakeChannel>(),
    rpc: vi.fn(),
  };
  const supabase = {
    rpc: (name: string, params: Record<string, unknown>) => state.rpc(name, params),
    channel: (name: string) => {
      const existing = state.topics.get(name);
      if (existing) {
        state.log.push(`reuse:${name}`);
        return existing;
      }
      state.log.push(`create:${name}`);
      const pending: Listener[] = [];
      const channel: FakeChannel = {
        name,
        state: 'closed',
        on(_t, filter, cb) {
          pending.push({ channel, table: filter.table, filter, cb });
          return channel;
        },
        subscribe() {
          if (channel.state !== 'closed') return channel;
          channel.state = 'joined';
          state.log.push(`subscribe:${name}`);
          state.listeners.push(...pending);
          return channel;
        },
      };
      state.topics.set(name, channel);
      return channel;
    },
    removeChannel: (ch: FakeChannel) => {
      state.log.push(`remove:${ch.name}`);
      ch.state = 'leaving';
      state.listeners = state.listeners.filter((l) => l.channel !== ch);
      return new Promise((resolve) =>
        setTimeout(() => {
          if (state.topics.get(ch.name) === ch) state.topics.delete(ch.name);
          resolve('ok');
        }, 0),
      );
    },
  };
  return { state, supabase };
});

const logHas = (re: RegExp) => h.state.log.some((e) => re.test(e));
const logIndex = (re: RegExp) => h.state.log.findIndex((e) => re.test(e));

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
  h.state.topics.clear();
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
    expect(logHas(/^create:post-discussao-1-\d+$/)).toBe(true);
  });

  it('subscribes only to the threads table when the post has no threads', () => {
    setup({ threads: [] });
    expect(h.state.listeners.map((l) => l.table)).toEqual(['post_comment_threads']);
  });

  it('re-subscribes when the thread id set changes', () => {
    const { rerender } = setup({ threads: [THREADS[0]] });
    expect(h.state.listeners.at(-1)?.filter.filter).toBe('thread_id=in.(10)');
    rerender({ postId: 1, threads: THREADS });
    // The old channel is still leaving: the new subscription must be a fresh, joined one.
    expect(h.state.log.some((e) => e.startsWith('reuse:'))).toBe(false);
    expect(h.state.listeners.at(-1)?.filter.filter).toBe('thread_id=in.(10,20)');
    expect(h.state.listeners.filter((l) => l.table === 'post_comments')).toHaveLength(1);
    expect(h.state.listeners.filter((l) => l.table === 'post_comment_threads')).toHaveLength(1);
  });

  it('removes the previous post channel before creating the next one', () => {
    const { rerender } = setup({ postId: 1 });
    rerender({ postId: 2, threads: THREADS });
    const removed = logIndex(/^remove:post-discussao-1-/);
    expect(removed).toBeGreaterThan(-1);
    expect(removed).toBeLessThan(logIndex(/^create:post-discussao-2-/));
    expect(h.state.listeners.filter((l) => l.table === 'post_comment_threads')).toHaveLength(1);
    expect(h.state.listeners.find((l) => l.table === 'post_comment_threads')?.filter.filter).toBe(
      'post_id=eq.2',
    );
  });

  it('removes the channel on unmount', () => {
    const { unmount } = setup();
    unmount();
    expect(logHas(/^remove:post-discussao-1-/)).toBe(true);
    expect(h.state.listeners).toHaveLength(0);
  });

  it('a remount for the same post gets a fresh channel while the old one is still leaving', () => {
    const first = setup();
    first.unmount();
    // No timers flushed: the previous channel has not seen its leave ack yet.
    setup();
    expect(h.state.log.some((e) => e.startsWith('reuse:'))).toBe(false);
    expect(h.state.log.filter((e) => e.startsWith('subscribe:'))).toHaveLength(2);
    expect(h.state.listeners.filter((l) => l.table === 'post_comment_threads')).toHaveLength(1);
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
    const { result } = setup({}, { seguindo: true, last_seen_comment_id: 0, implicito: true });
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

  it('does not mark while the document is hidden, and marks once it is visible again', async () => {
    await mount();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => liveObserver()?.trigger(1));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(rpcCalls('post_discussao_marcar_lido')).toHaveLength(0);
    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(rpcCalls('post_discussao_marcar_lido')).toHaveLength(1);
    visibility.mockRestore();
  });

  it('waits for the open-time participation fetch before marking (cached data race)', async () => {
    qc.setQueryData(['post-discussao-participacao', 1], {
      seguindo: true,
      lastSeenCommentId: 2,
      implicito: false,
    });
    let release: (v: unknown) => void = () => {};
    h.state.rpc.mockImplementation((name: string) => {
      if (name === 'get_post_discussao_participacao') {
        return new Promise((resolve) => {
          release = () => resolve({ data: [participacaoRow], error: null });
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    participacaoRow = { seguindo: true, last_seen_comment_id: 2, implicito: false };
    const { result } = renderHook(
      () => useDiscussao({ postId: 1, threads: THREADS, currentUserId: ME }),
      { wrapper },
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => result.current.sectionRef(document.createElement('div')));
    act(() => liveObserver()?.trigger(1));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(rpcCalls('post_discussao_marcar_lido')).toHaveLength(0);
    expect(result.current.unreadAnchorId).toBeNull();
    await act(async () => release(undefined));
    await waitFor(() => expect(result.current.unreadAnchorId).toBe(2));
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(rpcCalls('post_discussao_marcar_lido')).toHaveLength(1);
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

  it('toggleSeguir unfollows for the implicit responsible (no row, already notified)', async () => {
    const { result } = setup({}, { seguindo: true, last_seen_comment_id: 0, implicito: true });
    await waitFor(() => expect(result.current.isParticipant).toBe(true));
    await act(() => result.current.toggleSeguir());
    expect(rpcCalls('post_discussao_seguir')[0][1]).toEqual({ p_post_id: 1, p_seguir: false });
  });
});

describe('useDiscussao bystander anchor', () => {
  it('a bystander who starts following gets the open-time max id as anchor, not 0', async () => {
    const { result } = setup({}, { seguindo: false, last_seen_comment_id: 0, implicito: false });
    await waitFor(() => expect(result.current.participacao).toBeDefined());
    expect(result.current.unreadAnchorId).toBeNull();
    participacaoRow = { seguindo: true, last_seen_comment_id: 0, implicito: false };
    await act(() => result.current.toggleSeguir());
    await waitFor(() => expect(result.current.isParticipant).toBe(true));
    // Everything loaded when the section opened (max id 9) counts as seen.
    expect(result.current.unreadAnchorId).toBe(9);
  });
});

describe('useDiscussao bystander anchor, participation before threads', () => {
  it('follows the max id while a bystander and freezes it when they start following', async () => {
    const { result, rerender } = setup(
      { threads: [] },
      { seguindo: false, last_seen_comment_id: 0, implicito: false },
    );
    await waitFor(() => expect(result.current.participacao).toBeDefined());
    // The participation answered first; the threads arrive afterwards.
    rerender({ postId: 1, threads: THREADS });
    participacaoRow = { seguindo: true, last_seen_comment_id: 0, implicito: false };
    await act(() => result.current.toggleSeguir());
    await waitFor(() => expect(result.current.isParticipant).toBe(true));
    expect(result.current.unreadAnchorId).toBe(9);
    // Once a participant, newer messages stay above the anchor instead of moving it.
    rerender({
      postId: 1,
      threads: [
        THREADS[0],
        thread(20, [comment(7, 20, OTHER), comment(9, 20, OTHER), comment(12, 20, OTHER)]),
      ],
    });
    expect(result.current.unreadAnchorId).toBe(9);
  });
});

describe('useDiscussao enabled', () => {
  function setupEnabled(enabled: boolean) {
    participacaoRow = { seguindo: true, last_seen_comment_id: 2, implicito: false };
    return renderHook(
      (p: { enabled: boolean }) =>
        useDiscussao({ postId: 1, threads: THREADS, currentUserId: ME, enabled: p.enabled }),
      { wrapper, initialProps: { enabled } },
    );
  }

  it('does nothing while disabled: no channel, no participation fetch', async () => {
    const { result } = setupEnabled(false);
    await act(async () => {});
    expect(h.state.log).toEqual([]);
    expect(rpcCalls('get_post_discussao_participacao')).toHaveLength(0);
    expect(result.current.unreadAnchorId).toBeNull();
  });

  it('subscribes and fetches once enabled, and drops the channel when disabled again', async () => {
    const { result, rerender } = setupEnabled(false);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.unreadAnchorId).toBe(2));
    expect(logHas(/^subscribe:post-discussao-1-/)).toBe(true);
    rerender({ enabled: false });
    expect(h.state.log.at(-1)).toMatch(/^remove:post-discussao-1-/);
    expect(result.current.unreadAnchorId).toBeNull();
  });
});
