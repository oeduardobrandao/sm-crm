import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  groupBySeries,
  needsAutoRefresh,
  processingBadge,
  reorderedItems,
} from '../kb-video-status';
import type { KbVideo, KbVideoSeries } from '../api';

function video(overrides: Partial<KbVideo> = {}): KbVideo {
  return {
    id: 1,
    series_id: 's1',
    title: 'V',
    slug: 'v',
    description: null,
    article_id: null,
    display_order: 10,
    status: 'draft',
    stream_uid: null,
    stream_status: 'pending',
    stream_upload_expires_at: null,
    duration_seconds: null,
    hls_url: null,
    thumbnail_url: null,
    created_at: '2026-09-28T10:00:00.000Z',
    updated_at: '2026-09-28T10:00:00.000Z',
    ...overrides,
  };
}

describe('processingBadge', () => {
  it('names every Stream state the list can show', () => {
    expect(processingBadge(video()).label).toBe('Sem arquivo');
    expect(processingBadge(video({ stream_uid: 'u' })).label).toBe('Processando');
    expect(processingBadge(video({ stream_uid: 'u', stream_status: 'ready' })).label).toBe(
      'Pronto',
    );
    expect(processingBadge(video({ stream_uid: 'u', stream_status: 'error' })).label).toBe('Erro');
    expect(processingBadge(video({ stream_uid: null, stream_status: 'error' })).label).toBe(
      'Envio interrompido',
    );
  });
});

describe('needsAutoRefresh', () => {
  const now = Date.parse('2026-09-28T10:10:00.000Z');
  it('only for a pending upload with a uid older than 5 minutes', () => {
    expect(needsAutoRefresh(video({ stream_uid: 'u' }), now)).toBe(true);
    expect(
      needsAutoRefresh(video({ stream_uid: 'u', updated_at: '2026-09-28T10:08:00.000Z' }), now),
    ).toBe(false);
    expect(needsAutoRefresh(video(), now)).toBe(false);
    expect(needsAutoRefresh(video({ stream_uid: 'u', stream_status: 'ready' }), now)).toBe(false);
  });
});

describe('formatDuration', () => {
  it('formats m:ss and hides unknown durations', () => {
    expect(formatDuration(65.4)).toBe('1:05');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(null)).toBe('');
  });
});

describe('reorderedItems', () => {
  const list = [video({ id: 1 }), video({ id: 2 }), video({ id: 3 })];
  it('moves one item and renumbers the whole series in steps of 10', () => {
    expect(reorderedItems(list, 2, -1)).toEqual([
      { id: 1, display_order: 10 },
      { id: 3, display_order: 20 },
      { id: 2, display_order: 30 },
    ]);
  });
  it('returns null at the edges', () => {
    expect(reorderedItems(list, 0, -1)).toBeNull();
    expect(reorderedItems(list, 2, 1)).toBeNull();
  });
});

describe('groupBySeries', () => {
  it('keeps series order and sorts each group by display_order', () => {
    const series: KbVideoSeries[] = [
      {
        id: 's2',
        title: 'B',
        slug: 'b',
        description: null,
        display_order: 2,
        status: 'draft',
        created_at: '',
        updated_at: '',
      },
      {
        id: 's1',
        title: 'A',
        slug: 'a',
        description: null,
        display_order: 1,
        status: 'draft',
        created_at: '',
        updated_at: '',
      },
    ];
    const groups = groupBySeries(series, [
      video({ id: 1, series_id: 's1', display_order: 20 }),
      video({ id: 2, series_id: 's1', display_order: 10 }),
      video({ id: 3, series_id: 's2' }),
    ]);
    expect(groups.map((g) => g.series.id)).toEqual(['s1', 's2']);
    expect(groups[0].videos.map((v) => v.id)).toEqual([2, 1]);
  });
});
