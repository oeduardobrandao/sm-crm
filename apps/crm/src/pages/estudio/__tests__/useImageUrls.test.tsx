import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc, makePage, makeTextLayer } from './fixtures';

const filesTableIn = vi.fn();
const getSession = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: (column: string, ids: number[]) => filesTableIn(table, columns, column, ids),
      }),
    }),
    auth: { getSession: () => getSession() },
  },
}));

import { useImageUrls } from '../hooks/useImageUrls';

function renderWithClient(doc: Parameters<typeof useImageUrls>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useImageUrls(doc), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

function docWithImage(fileId: number) {
  return makeDoc({
    pages: [
      makePage({
        background: { type: 'image', file_id: fileId, fit: 'cover' },
        layers: [makeTextLayer({ id: 'a' })],
      }),
    ],
  });
}

describe('useImageUrls', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    filesTableIn.mockResolvedValue({
      data: [{ id: 42, r2_key: 'contas/c1/files/photo.jpg' }],
      error: null,
    });
    getSession.mockResolvedValue({ data: { session: { access_token: 'token-123' } } });
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ urls: { 'contas/c1/files/photo.jpg': 'https://r2.example/signed' } }),
          {
            status: 200,
          },
        ),
    ) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves a background file_id to its signed URL', async () => {
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.get(42)).toBe('https://r2.example/signed');
  });

  it('calls files.select().in() with the collected file_ids and sign-r2-urls with the resolved keys', async () => {
    renderWithClient(docWithImage(42));
    await waitFor(() =>
      expect(filesTableIn).toHaveBeenCalledWith('files', 'id, r2_key', 'id', [42]),
    );
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/functions/v1/sign-r2-urls'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
          body: JSON.stringify({ keys: ['contas/c1/files/photo.jpg'] }),
        }),
      ),
    );
  });

  it('short-circuits to an empty map with no network calls when the doc has no image references', async () => {
    const { result } = renderWithClient(makeDoc());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(new Map());
    expect(filesTableIn).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is disabled (no query at all) when doc is undefined', () => {
    renderWithClient(undefined);
    expect(filesTableIn).not.toHaveBeenCalled();
  });

  it('rejects when there is no active session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'not authenticated' });
  });

  it('rejects when sign-r2-urls responds with a non-ok status', async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 500 })) as typeof fetch;
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: expect.stringContaining('500') });
  });

  it('a file_id present in `files` but missing from the returned urls map resolves to a partial map, not a crash', async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ urls: {} }), { status: 200 }),
    ) as typeof fetch;
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.has(42)).toBe(false);
    expect(result.current.data!.size).toBe(0);
  });

  it('propagates a `files` table query error', async () => {
    filesTableIn.mockResolvedValue({ data: null, error: new Error('rls denied') });
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: 'rls denied' });
  });
});
