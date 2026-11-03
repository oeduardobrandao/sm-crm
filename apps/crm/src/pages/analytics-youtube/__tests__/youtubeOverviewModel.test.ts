import { describe, expect, it } from 'vitest';
import { filterChannels, sortChannels, statusCounts } from '../youtubeOverviewModel';
import { channel, revoked } from './fixtures';

const rows = [
  channel(1, 'Clínica Viva', { title: 'Saúde em Foco', handle: '@saudeemfoco' }),
  channel(2, 'Pet Center', { title: 'Pet Center TV', handle: '@petcentertv' }),
  revoked(3, 'Studio Bella', { title: 'Studio Bella', handle: '@studiobella' }),
];

const ids = (list: { clientId: number }[]) => list.map((c) => c.clientId);
const metrics = channel(0, 'x').metrics;

describe('filterChannels', () => {
  const all = { query: '', clientId: 'all', status: 'all' } as const;

  it('matches the title, the handle or the client name, ignoring case and accents', () => {
    expect(ids(filterChannels(rows, { ...all, query: 'SAUDE' }))).toEqual([1]);
    expect(ids(filterChannels(rows, { ...all, query: 'clinica' }))).toEqual([1]);
    expect(ids(filterChannels(rows, { ...all, query: '@petcenter' }))).toEqual([2]);
    expect(ids(filterChannels(rows, { ...all, query: 'studiob' }))).toEqual([3]);
    expect(ids(filterChannels(rows, { ...all, query: '  ' }))).toEqual([1, 2, 3]);
  });

  it('narrows to one client', () => {
    expect(ids(filterChannels(rows, { ...all, clientId: '2' }))).toEqual([2]);
  });

  it('status revoked keeps only the channels that need reconnecting', () => {
    expect(ids(filterChannels(rows, { ...all, status: 'revoked' }))).toEqual([3]);
  });

  it('counts per status', () => {
    expect(statusCounts(rows)).toEqual({ all: 3, revoked: 1 });
  });
});

describe('sortChannels', () => {
  const withNulls = [
    revoked(10, 'Null A'),
    channel(11, 'Low', { metrics: { ...metrics, views: 5 } }),
    revoked(12, 'Null B'),
    channel(13, 'High', { metrics: { ...metrics, views: 500 } }),
  ];

  it('puts channels without a value last, descending', () => {
    const sorted = sortChannels(withNulls, 'views', 'desc');
    expect(ids(sorted).slice(0, 2)).toEqual([13, 11]);
    expect(ids(sorted).slice(2).sort()).toEqual([10, 12]);
  });

  it('puts channels without a value last, ascending', () => {
    const sorted = sortChannels(withNulls, 'views', 'asc');
    expect(ids(sorted).slice(0, 2)).toEqual([11, 13]);
    expect(ids(sorted).slice(2).sort()).toEqual([10, 12]);
  });

  it('a revoked channel sorts last even when the server still sent numbers', () => {
    const stale = channel(20, 'Stale', {
      authorizationStatus: 'revoked',
      metrics: { ...metrics, views: 99999 },
    });
    expect(ids(sortChannels([stale, withNulls[1]], 'views', 'desc'))).toEqual([11, 20]);
  });

  it('sorts watch hours, the Shorts share and the last sync', () => {
    const a = channel(1, 'A', {
      lastSyncedAt: '2026-11-01T00:00:00Z',
      metrics: { ...metrics, watchMinutes: 60, shortsShare: 0.9 },
    });
    const b = channel(2, 'B', {
      lastSyncedAt: '2026-11-02T00:00:00Z',
      metrics: { ...metrics, watchMinutes: 120, shortsShare: 0.1 },
    });
    const c = channel(3, 'C', { lastSyncedAt: null });
    expect(ids(sortChannels([a, b], 'watchHours', 'desc'))).toEqual([2, 1]);
    expect(ids(sortChannels([a, b], 'shortsShare', 'desc'))).toEqual([1, 2]);
    expect(ids(sortChannels([c, a, b], 'lastSyncedAt', 'desc'))).toEqual([2, 1, 3]);
    expect(ids(sortChannels([c, a, b], 'lastSyncedAt', 'asc'))).toEqual([1, 2, 3]);
  });

  it('sorts by the name the cell shows: title, else handle, else the client name', () => {
    const list = [
      channel(1, 'X', { title: 'Zeta' }),
      channel(2, 'Mário', { title: null, handle: null }),
      channel(3, 'Z', { title: 'Ágata' }),
      channel(4, 'W', { title: null, handle: '@bruno' }),
    ];
    expect(ids(sortChannels(list, 'title', 'asc'))).toEqual([4, 3, 2, 1]);
    expect(ids(sortChannels(list, 'title', 'desc'))).toEqual([1, 2, 3, 4]);
  });

  it('does not mutate its input', () => {
    const copy = [...withNulls];
    sortChannels(withNulls, 'views', 'desc');
    expect(withNulls).toEqual(copy);
  });
});
