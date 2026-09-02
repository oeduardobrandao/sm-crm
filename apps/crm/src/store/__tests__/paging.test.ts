import { describe, it, expect, vi } from 'vitest';
import { fetchAllPaged } from '../paging';

describe('fetchAllPaged', () => {
  it('concatenates pages until a short page arrives', async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => i);
    const page2 = [3, 4];
    const fetchPage = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const all = await fetchAllPaged(fetchPage, 3);
    expect(all).toEqual([0, 1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 2);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 3, 5);
  });
  it('stops after one call when the first page is short', async () => {
    const fetchPage = vi.fn().mockResolvedValue([1]);
    await expect(fetchAllPaged(fetchPage, 1000)).resolves.toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it('returns empty for an empty first page', async () => {
    const fetchPage = vi.fn().mockResolvedValue([]);
    await expect(fetchAllPaged(fetchPage, 10)).resolves.toEqual([]);
  });
});
