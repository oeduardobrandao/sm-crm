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

import { clearImageUrlCachesForTest, seedImageUrl, useImageUrls } from '../hooks/useImageUrls';

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

/** fetch stub routed by URL: sign POST, direct signed GET, and the byte-proxy GET. */
function routeFetch(opts: {
  signedUrl?: string;
  directOk?: boolean;
  proxyOk?: boolean;
  signStatus?: number;
}) {
  const { signedUrl = 'https://r2.example/signed', directOk = true, proxyOk = true } = opts;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/functions/v1/sign-r2-urls?key=')) {
      if (!proxyOk) return new Response(null, { status: 404 });
      return new Response(new Blob([new Uint8Array([9, 9])], { type: 'image/png' }), {
        status: 200,
      });
    }
    if (url.includes('/functions/v1/sign-r2-urls')) {
      if (opts.signStatus) return new Response(null, { status: opts.signStatus });
      return new Response(JSON.stringify({ urls: { 'contas/c1/files/photo.jpg': signedUrl } }), {
        status: 200,
      });
    }
    if (url === signedUrl) {
      if (!directOk) throw new TypeError('Failed to fetch'); // the CORS shape
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), {
        status: 200,
      });
    }
    void init;
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

describe('useImageUrls', () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  let blobCounter = 0;

  beforeEach(() => {
    clearImageUrlCachesForTest();
    blobCounter = 0;
    URL.createObjectURL = vi.fn(() => `blob:mock-${++blobCounter}`);
    filesTableIn.mockResolvedValue({
      data: [{ id: 42, r2_key: 'contas/c1/files/photo.jpg' }],
      error: null,
    });
    getSession.mockResolvedValue({ data: { session: { access_token: 'token-123' } } });
    global.fetch = routeFetch({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
  });

  it('resolves a background file_id to a blob URL via the direct signed fetch', async () => {
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.get(42)).toBe('blob:mock-1');
    // No byte-proxy call on the happy path.
    const proxyCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('sign-r2-urls?key='),
    );
    expect(proxyCalls).toHaveLength(0);
  });

  it('falls back to the byte-proxy (with auth) when the direct fetch fails CORS-style', async () => {
    global.fetch = routeFetch({ directOk: false });
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.get(42)).toMatch(/^blob:mock-/);
    const proxyCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes('sign-r2-urls?key=contas%2Fc1%2Ffiles%2Fphoto.jpg'),
    );
    expect(proxyCall).toBeTruthy();
    expect(proxyCall![1]).toMatchObject({
      headers: { Authorization: 'Bearer token-123' },
    });
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

  it('reuses the module blob cache — a second doc resolution makes zero network calls', async () => {
    const first = renderWithClient(docWithImage(42));
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const callsAfterFirst = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    const second = renderWithClient(docWithImage(42));
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(second.result.current.data!.get(42)).toBe(first.result.current.data!.get(42));
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it('a seeded signed URL resolves with a single direct fetch (no table, no sign round trip)', async () => {
    seedImageUrl(42, 'https://r2.example/signed');
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.get(42)).toBe('blob:mock-1');
    expect(filesTableIn).not.toHaveBeenCalled();
  });

  it('a seeded URL that fails falls through to the full resolution path', async () => {
    seedImageUrl(42, 'https://r2.example/expired-seed');
    global.fetch = routeFetch({}); // seed URL is not routed → its fetch throws → fallthrough
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.get(42)).toMatch(/^blob:mock-/);
    expect(filesTableIn).toHaveBeenCalled();
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
    global.fetch = routeFetch({ signStatus: 500 });
    const { result } = renderWithClient(docWithImage(42));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: expect.stringContaining('500') });
  });

  it('a file whose direct AND proxy fetches fail resolves to a partial map, not a crash', async () => {
    global.fetch = routeFetch({ directOk: false, proxyOk: false });
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
