import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImport } = vi.hoisted(() => ({ mockImport: vi.fn() }));

vi.mock('@/store/savedViews', () => ({
  importSavedViews: mockImport,
  SAVED_VIEW_NAME_MAX: 80,
  SAVED_VIEW_QUERY_MAX: 4000,
}));

import { importLegacySavedViews, loadLegacySavedViews } from '../savedViews';

const CONTA = 'conta-1';
const LEGACY = `entregas_saved_views_${CONTA}`;
const MARKER = `entregas_saved_views_imported_${CONTA}`;

const seed = (key: string, views: unknown) => localStorage.setItem(key, JSON.stringify(views));

describe('importLegacySavedViews', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockImport.mockResolvedValue(undefined);
  });

  it("is skipped while contaId is the 'unknown' fallback", async () => {
    seed('entregas_saved_views_unknown', [{ name: 'A', query: 'q' }]);
    await expect(importLegacySavedViews('unknown', [])).resolves.toBe(false);
    expect(mockImport).not.toHaveBeenCalled();
    expect(localStorage.getItem('entregas_saved_views_imported_unknown')).toBeNull();
  });

  it('imports the active workspace list, writes the marker and keeps the old key', async () => {
    const legacy = [
      { name: 'Atrasados', query: 'prazo=atrasado' },
      { name: 'Lista', query: 'view=list' },
    ];
    seed(LEGACY, legacy);
    seed('entregas_saved_views_outra-conta', [{ name: 'Outra', query: 'x' }]);

    await expect(importLegacySavedViews(CONTA, [])).resolves.toBe(true);
    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockImport).toHaveBeenCalledWith(CONTA, [
      { name: 'Atrasados', query: 'prazo=atrasado', position: 0 },
      { name: 'Lista', query: 'view=list', position: 1 },
    ]);
    expect(localStorage.getItem(MARKER)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(LEGACY) ?? 'null')).toEqual(legacy);
    expect(localStorage.getItem('entregas_saved_views_imported_outra-conta')).toBeNull();
  });

  it('runs once: with the marker present nothing is sent', async () => {
    seed(LEGACY, [{ name: 'A', query: 'q' }]);
    await importLegacySavedViews(CONTA, []);
    await expect(importLegacySavedViews(CONTA, [])).resolves.toBe(false);
    expect(mockImport).toHaveBeenCalledTimes(1);
  });

  it('appends after the rows already on the server', async () => {
    seed(LEGACY, [{ name: 'A', query: 'q' }]);
    await importLegacySavedViews(CONTA, [
      { id: 'x', name: 'Server', query: 's', position: 4 },
      { id: 'y', name: 'Server 2', query: 's2', position: 1 },
    ]);
    expect(mockImport).toHaveBeenCalledWith(CONTA, [{ name: 'A', query: 'q', position: 5 }]);
  });

  it('drops entries the table would reject and keeps one per name', async () => {
    seed(LEGACY, [
      { name: '  Espaços  ', query: 'a=1' },
      { name: '   ', query: 'a=2' },
      { name: 'n'.repeat(90), query: 'a=3' },
      { name: 'Grande', query: 'q'.repeat(4001) },
      { name: 'Espaços', query: 'a=4' },
      { name: 42, query: 'a=5' },
    ]);
    await importLegacySavedViews(CONTA, []);
    expect(mockImport).toHaveBeenCalledWith(CONTA, [
      { name: 'Espaços', query: 'a=1', position: 0 },
      { name: 'n'.repeat(80), query: 'a=3', position: 1 },
    ]);
  });

  it('an empty or missing list only writes the marker', async () => {
    await expect(importLegacySavedViews(CONTA, [])).resolves.toBe(false);
    expect(mockImport).not.toHaveBeenCalled();
    expect(localStorage.getItem(MARKER)).not.toBeNull();
  });

  it('corrupted storage counts as an empty list', async () => {
    localStorage.setItem(LEGACY, '{not json');
    expect(loadLegacySavedViews(CONTA)).toEqual([]);
    await expect(importLegacySavedViews(CONTA, [])).resolves.toBe(false);
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('a failed insert leaves the marker unset so the next load retries', async () => {
    seed(LEGACY, [{ name: 'A', query: 'q' }]);
    mockImport.mockRejectedValueOnce(new Error('offline'));
    await expect(importLegacySavedViews(CONTA, [])).rejects.toThrow('offline');
    expect(localStorage.getItem(MARKER)).toBeNull();

    await expect(importLegacySavedViews(CONTA, [])).resolves.toBe(true);
    expect(mockImport).toHaveBeenCalledTimes(2);
  });

  it('does not throw when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    await expect(importLegacySavedViews(CONTA, [])).resolves.toBe(false);
    expect(mockImport).not.toHaveBeenCalled();
  });
});
