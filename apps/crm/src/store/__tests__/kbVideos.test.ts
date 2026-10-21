import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }));
vi.mock('../core', () => ({ supabase: { from: fromMock, rpc: rpcMock } }));

import { getMyVideoProgress, getPublishedVideoSeries, saveVideoProgress } from '../kbVideos';

function selectChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

const video = (id: number, display_order: number) => ({
  id,
  series_id: 's1',
  title: `V${id}`,
  slug: `v${id}`,
  description: null,
  display_order,
  duration_seconds: 60,
  hls_url: `https://h/${id}.m3u8`,
  thumbnail_url: null,
  article: null,
});

describe('store/kbVideos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops series without a visible video and sorts each series by display_order', async () => {
    fromMock.mockReturnValue(
      selectChain({
        data: [
          {
            id: 's1',
            title: 'A',
            slug: 'a',
            description: null,
            display_order: 1,
            videos: [video(2, 20), video(1, 10)],
          },
          {
            id: 's2',
            title: 'Vazia',
            slug: 'vazia',
            description: null,
            display_order: 2,
            videos: [],
          },
          {
            id: 's3',
            title: 'Nula',
            slug: 'nula',
            description: null,
            display_order: 3,
            videos: null,
          },
        ],
        error: null,
      }),
    );

    const series = await getPublishedVideoSeries();

    expect(fromMock).toHaveBeenCalledWith('kb_video_series');
    expect(series.map((s) => s.id)).toEqual(['s1']);
    expect(series[0].videos.map((v) => v.id)).toEqual([1, 2]);
  });

  it('throws when the series query fails', async () => {
    fromMock.mockReturnValue(selectChain({ data: null, error: { message: 'boom' } }));
    await expect(getPublishedVideoSeries()).rejects.toBeTruthy();
  });

  it('reads only the progress columns it needs', async () => {
    const chain = selectChain({
      data: [{ video_id: 1, position_seconds: 12, completed_at: null }],
      error: null,
    });
    fromMock.mockReturnValue(chain);
    const rows = await getMyVideoProgress();
    expect(fromMock).toHaveBeenCalledWith('kb_video_progress');
    expect(chain.select).toHaveBeenCalledWith('video_id,position_seconds,completed_at');
    expect(rows).toHaveLength(1);
  });

  it('saves progress through the RPC with p_-prefixed params', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await saveVideoProgress(7, 42.5, true);
    expect(rpcMock).toHaveBeenCalledWith('save_kb_video_progress', {
      p_video_id: 7,
      p_position: 42.5,
      p_completed: true,
    });
  });

  it('throws when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(saveVideoProgress(7, 1, false)).rejects.toBeTruthy();
  });
});
