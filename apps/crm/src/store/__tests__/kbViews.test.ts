import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('../core', () => ({ supabase: { rpc: rpcMock } }));

import { recordKbView } from '../kbViews';

describe('store/kbViews', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends only p_article_id for an article', async () => {
    rpcMock.mockResolvedValue({ error: null });
    await recordKbView({ articleId: 'a1' });
    expect(rpcMock).toHaveBeenCalledWith('record_kb_view', { p_article_id: 'a1' });
  });

  it('sends only p_video_id for a video', async () => {
    rpcMock.mockResolvedValue({ error: null });
    await recordKbView({ videoId: 7 });
    expect(rpcMock).toHaveBeenCalledWith('record_kb_view', { p_video_id: 7 });
  });

  it('throws the RPC error', async () => {
    rpcMock.mockResolvedValue({ error: { message: 'boom' } });
    await expect(recordKbView({ videoId: 7 })).rejects.toEqual({ message: 'boom' });
  });
});
