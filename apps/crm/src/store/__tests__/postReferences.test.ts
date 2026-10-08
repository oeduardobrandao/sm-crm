import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SessionResult = { data: { session: { access_token: string } | null } };

const { fromMock, getSessionMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getSessionMock: vi.fn(
    async (): Promise<SessionResult> => ({
      data: { session: { access_token: 'jwt' } },
    }),
  ),
}));
vi.mock('../core', () => ({
  supabase: { from: fromMock, auth: { getSession: getSessionMock } },
}));

import { deletePostReference, getPostReferenceCounts, getPostReferences } from '../postReferences';

const fetchMock = vi.fn();

describe('store/postReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists a post's references through post-references with the user JWT", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 7 }] })));

    const items = await getPostReferences(12);

    expect(items).toEqual([{ id: 7 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://mesaas.supabase.co/functions/v1/post-references?post_id=12');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer jwt');
    expect(init.headers.apikey).toBe('anon-key-for-tests');
  });

  it('deletes one reference by id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await deletePostReference(7);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://mesaas.supabase.co/functions/v1/post-references/7');
    expect(init.method).toBe('DELETE');
  });

  it("surfaces the function's error code", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );
    await expect(deletePostReference(7)).rejects.toThrow('forbidden');
  });

  it('falls back to the HTTP status when the body has no code', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }));
    await expect(getPostReferences(1)).rejects.toThrow('HTTP 500');
  });

  it('refuses to call the function without a session', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } });
    await expect(getPostReferences(1)).rejects.toThrow('Não autenticado');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts references per post from one RLS-scoped select', async () => {
    const inMock = vi.fn(async () => ({
      data: [{ post_id: 1 }, { post_id: 1 }, { post_id: 3 }],
      error: null,
    }));
    const selectMock = vi.fn(() => ({ in: inMock }));
    fromMock.mockReturnValue({ select: selectMock });

    await expect(getPostReferenceCounts([1, 2, 3])).resolves.toEqual({ 1: 2, 3: 1 });
    expect(fromMock).toHaveBeenCalledWith('post_references');
    expect(selectMock).toHaveBeenCalledWith('post_id');
    expect(inMock).toHaveBeenCalledWith('post_id', [1, 2, 3]);
  });

  it('skips the query when there are no posts', async () => {
    await expect(getPostReferenceCounts([])).resolves.toEqual({});
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('throws when the count select fails', async () => {
    fromMock.mockReturnValue({
      select: () => ({ in: async () => ({ data: null, error: { message: 'boom' } }) }),
    });
    await expect(getPostReferenceCounts([1])).rejects.toBeTruthy();
  });
});
