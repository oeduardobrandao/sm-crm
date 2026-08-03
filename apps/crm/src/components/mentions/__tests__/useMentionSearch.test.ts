import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeForSearch,
  filterAndCapMentions,
  MAX_RESULTS_PER_SECTION,
  type MentionSection,
} from '../useMentionSearch';

// getMembros/getClientes/getTarefas are mocked so the hook's useQuery calls resolve
// deterministically without a real Supabase client. searchPostsForMention is mocked
// separately (per-test) to control exactly when the async post search resolves --
// that's the axis the staleness-guard test below needs to control.
vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMembros: vi.fn().mockResolvedValue([]),
    getClientes: vi.fn().mockResolvedValue([]),
    getTarefas: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('@/store/posts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    searchPostsForMention: vi.fn().mockResolvedValue([]),
  };
});

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function postsSection(sections: MentionSection[]) {
  return sections.find((s) => s.key === 'post')?.items ?? [];
}

/** Lets the hook's initial membros/clientes/tarefas useQuery fetches (mocked, so they
 * settle almost immediately) resolve -- and their resulting state update commit --
 * inside act(), before the test drives search() itself. A real macrotask (setTimeout)
 * always runs after every currently-queued microtask, so this reliably drains
 * however many .then() hops react-query's fetch/observer machinery needs. Must be
 * called BEFORE vi.useFakeTimers() (it needs a real timer to flush against). */
async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('normalizeForSearch', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeForSearch('João')).toBe('joao');
    expect(normalizeForSearch('CLÍNICA')).toBe('clinica');
    expect(normalizeForSearch('Ágata Núñez')).toBe('agata nunez');
  });

  it('is a no-op for plain lowercase ASCII', () => {
    expect(normalizeForSearch('ana')).toBe('ana');
  });
});

describe('filterAndCapMentions', () => {
  const items = [
    { label: 'Ana' },
    { label: 'André' },
    { label: 'Bruno' },
    { label: 'Camila' },
    { label: 'Carla' },
    { label: 'Caio' },
    { label: 'Clínica São José' },
  ];

  it('matches accent-insensitively and case-insensitively', () => {
    expect(filterAndCapMentions(items, 'andre').map((i) => i.label)).toEqual(['André']);
    expect(filterAndCapMentions(items, 'ANDRÉ').map((i) => i.label)).toEqual(['André']);
    expect(filterAndCapMentions(items, 'clinica').map((i) => i.label)).toEqual([
      'Clínica São José',
    ]);
  });

  it('matches on a substring, not just a prefix', () => {
    expect(filterAndCapMentions(items, 'an').map((i) => i.label)).toEqual(['Ana', 'André']);
  });

  it('returns everything (capped) for an empty/whitespace query', () => {
    const result = filterAndCapMentions(items, '   ');
    expect(result).toHaveLength(MAX_RESULTS_PER_SECTION);
    expect(result.map((i) => i.label)).toEqual(
      items.slice(0, MAX_RESULTS_PER_SECTION).map((i) => i.label),
    );
  });

  it('caps results at the default limit (5)', () => {
    const result = filterAndCapMentions(items, 'ca');
    // Camila, Carla, Caio, Clínica São José all contain "ca" (case/accent-insensitive)
    expect(result.length).toBeLessThanOrEqual(MAX_RESULTS_PER_SECTION);
  });

  it('honors a custom limit', () => {
    expect(filterAndCapMentions(items, '', 2)).toHaveLength(2);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterAndCapMentions(items, 'zzz')).toEqual([]);
  });
});

describe('useMentionSearch (hook) -- search()', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const store = await import('@/store');
    (store.getMembros as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.getClientes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.getTarefas as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a normal, non-overlapping call with the post search results for its own query', async () => {
    const postsModule = await import('@/store/posts');
    const searchPostsForMention = postsModule.searchPostsForMention as ReturnType<typeof vi.fn>;
    searchPostsForMention.mockResolvedValue([{ id: 1, titulo: 'Post Único', workflow_id: 7 }]);

    const { useMentionSearch } = await import('../useMentionSearch');
    const { result } = renderHook(() => useMentionSearch(), { wrapper: createWrapper() });
    await flushMicrotasks();

    const sections = await result.current.search('unico');

    expect(postsSection(sections)).toEqual([
      { entityType: 'post', id: 1, label: 'Post Único', parentId: 7 },
    ]);
  });

  // Pins the review finding: @tiptap/suggestion cannot be trusted to apply items()
  // results in call order (it reuses a single closure-level `props` object across
  // updates -- see mentionSuggestion.ts), so useMentionSearch's search() must itself
  // guarantee a superseded call never resolves with its own (query-correct but
  // out-of-date) sections. Repro: type "ab" (slow post search in flight), pause past
  // the debounce, type "abc" (fast post search resolves first) -- "ab"'s eventual
  // resolution must be a no-op, not a render of stale "ab" results over "abc"'s.
  it('a slower, older call resolves as a no-op when a newer call already applied its result', async () => {
    const postsModule = await import('@/store/posts');
    const searchPostsForMention = postsModule.searchPostsForMention as ReturnType<typeof vi.fn>;

    let resolveAb!: (rows: unknown[]) => void;
    let resolveAbc!: (rows: unknown[]) => void;
    const abPromise = new Promise((resolve) => {
      resolveAb = resolve;
    });
    const abcPromise = new Promise((resolve) => {
      resolveAbc = resolve;
    });
    searchPostsForMention.mockImplementationOnce(() => abPromise);
    searchPostsForMention.mockImplementationOnce(() => abcPromise);

    const { useMentionSearch } = await import('../useMentionSearch');
    const { result } = renderHook(() => useMentionSearch(), { wrapper: createWrapper() });
    await flushMicrotasks();

    // Only fake the debounce's setTimeout from here on -- the query settle above
    // needed a real one.
    vi.useFakeTimers();

    // Types "ab" -- starts its 200ms debounce.
    const abSearch = result.current.search('ab');
    // Debounce elapses: searchPostsForMention('ab') fires and is left pending on abPromise.
    await vi.advanceTimersByTimeAsync(200);
    expect(searchPostsForMention).toHaveBeenCalledTimes(1);

    // Pauses, then types "abc" -- a second, newer call starts and its own debounce elapses.
    const abcSearch = result.current.search('abc');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchPostsForMention).toHaveBeenCalledTimes(2);

    // "abc"'s post search resolves FIRST (fast) and gets applied.
    resolveAbc([{ id: 2, titulo: 'Post ABC', workflow_id: 20 }]);
    const abcResult = await abcSearch;
    expect(postsSection(abcResult)).toEqual([
      { entityType: 'post', id: 2, label: 'Post ABC', parentId: 20 },
    ]);

    // "ab"'s post search resolves LAST (slow), well after "abc" already rendered.
    resolveAb([{ id: 1, titulo: 'Post AB', workflow_id: 10 }]);
    const abResult = await abSearch;

    // The stale "ab" resolution must be a no-op: the exact same (already-applied,
    // newer) result comes back, not a fresh "ab" section overwriting "abc"'s.
    expect(abResult).toBe(abcResult);
  });
});
