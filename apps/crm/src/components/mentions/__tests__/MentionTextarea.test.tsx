import { createElement, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MentionTextarea } from '../MentionTextarea';

// Same mocking pattern as useMentionSearch.test.ts -- MentionTextarea is built
// directly on top of that hook, so its data dependencies are the same.
vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMembros: vi.fn().mockResolvedValue([{ id: 1, nome: 'Ana', avatar_url: null }]),
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

function Harness({ initialValue = '' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <MentionTextarea
      data-testid="ta"
      value={value}
      onValueChange={setValue}
      placeholder="Escreva..."
    />
  );
}

/**
 * Renders the harness and waits for the underlying membros/clientes/tarefas
 * useQuery fetches (mocked, so they settle almost immediately) to actually commit
 * into the QueryClient cache before a test drives the textarea. Polling the cache
 * with `waitFor` (real timers, retried over ~1s) rather than a single fixed
 * `setTimeout(0)` -- react-query's fetch -> observer -> notifyManager chain can take
 * more than one macrotask hop to settle, and a fixed-tick flush was flaky here (an
 * `@` fired before the membros query resolves searches a closure over an empty
 * list -- see MentionTextarea's `search` usage -- and nothing re-runs that search
 * later just because the query eventually settles, matching mentionSuggestion.ts's
 * same trade-off for the TipTap dropdown).
 */
async function renderHarness(initialValue = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const result = render(<Harness initialValue={initialValue} />, { wrapper });
  await waitFor(() => expect(queryClient.getQueryState(['membros'])?.status).toBe('success'));
  return result;
}

function getTextarea() {
  return screen.getByTestId('ta') as HTMLTextAreaElement;
}

describe('MentionTextarea', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const store = await import('@/store');
    (store.getMembros as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, nome: 'Ana', avatar_url: null },
    ]);
    (store.getClientes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (store.getTarefas as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const postsModule = await import('@/store/posts');
    (postsModule.searchPostsForMention as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('does not show the dropdown for plain text without an @ trigger', async () => {
    await renderHarness();
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: 'oi tudo bem' } });
    await waitFor(() => expect(ta.value).toBe('oi tudo bem'));
    expect(document.querySelector('.mention-suggestion-list')).toBeNull();
  });

  it('typing "@" opens the dropdown with the Pessoas section', async () => {
    await renderHarness();
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '@' } });
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
    expect(screen.getByText('Pessoas')).toBeInTheDocument();
  });

  it('selecting a suggestion inserts the formatted token and closes the dropdown', async () => {
    await renderHarness();
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '@' } });
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Ana'));

    await waitFor(() => expect(ta.value).toBe('@[Ana](membro:1) '));
    expect(document.querySelector('.mention-suggestion-list')).toBeNull();
  });

  it('filters by the typed query text', async () => {
    await renderHarness();
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: 'oi @ana' } });
    // Caret sits at the end after fireEvent.change assigns .value directly.
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());
  });

  it('Escape closes the dropdown without changing the value', async () => {
    await renderHarness();
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '@' } });
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());

    fireEvent.keyDown(ta, { key: 'Escape' });

    await waitFor(() => expect(document.querySelector('.mention-suggestion-list')).toBeNull());
    expect(ta.value).toBe('@');
  });

  it('a trigger only activates when the @ is at the start or after whitespace', async () => {
    await renderHarness();
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: 'email@dominio' } });
    await waitFor(() => expect(ta.value).toBe('email@dominio'));
    expect(document.querySelector('.mention-suggestion-list')).toBeNull();
  });

  it('closes the dropdown on blur', async () => {
    await renderHarness();
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '@' } });
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument());

    fireEvent.blur(ta);

    await waitFor(() => expect(document.querySelector('.mention-suggestion-list')).toBeNull());
  });
});
