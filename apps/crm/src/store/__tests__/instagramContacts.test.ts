import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockFrom: vi.fn() }));

vi.mock('../core', () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
  getUserId: vi.fn(),
  getContaId: vi.fn(),
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));

import {
  contactFiltersToRpcArgs,
  countInstagramContacts,
  fetchAllInstagramContacts,
  listInstagramContacts,
  type ContactFilters,
} from '../instagramContacts';

const F: ContactFilters = {
  clientId: null,
  automationId: null,
  from: null,
  to: null,
  reachedOnly: true,
  search: '',
};

function row(id: string, created_at: string) {
  return { id, created_at, total_count: 3 };
}

describe('instagramContacts store', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps local calendar dates to [start of first day, start of day after last)', () => {
    const args = contactFiltersToRpcArgs({
      ...F,
      from: '2026-10-01',
      to: '2026-10-03',
      search: ' ana ',
    });
    expect(args.p_from).toBe(new Date(2026, 9, 1).toISOString());
    expect(args.p_to).toBe(new Date(2026, 9, 4).toISOString());
    expect(args.p_search).toBe('ana');
    expect(args.p_reached_only).toBe(true);
  });

  it('sends nulls for empty filters', () => {
    expect(contactFiltersToRpcArgs(F)).toEqual({
      p_client_id: null,
      p_automation_id: null,
      p_from: null,
      p_to: null,
      p_reached_only: true,
      p_search: null,
    });
  });

  it('lists a page with offset and reads total from the first row (0 when empty)', async () => {
    mockRpc.mockResolvedValueOnce({ data: [row('a', 't1')], error: null });
    const page = await listInstagramContacts(F, 3);
    expect(mockRpc).toHaveBeenCalledWith(
      'list_instagram_automation_contacts',
      expect.objectContaining({ p_limit: 50, p_offset: 100 }),
    );
    expect(page.total).toBe(3);

    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await listInstagramContacts(F, 1)).total).toBe(0);
  });

  it('pages the export by keyset until a short page', async () => {
    const full = Array.from({ length: 500 }, (_, i) =>
      row(`id${i}`, `2026-10-01T00:00:${String(i % 60).padStart(2, '0')}Z`),
    );
    mockRpc
      .mockResolvedValueOnce({ data: full, error: null })
      .mockResolvedValueOnce({ data: [row('last', '2026-10-02T00:00:00Z')], error: null });
    const all = await fetchAllInstagramContacts(F);
    expect(all).toHaveLength(501);
    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'list_instagram_automation_contacts',
      expect.objectContaining({
        p_export: true,
        p_limit: 500,
        p_cursor_at: null,
        p_cursor_id: null,
      }),
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'list_instagram_automation_contacts',
      expect.objectContaining({ p_cursor_at: full[499].created_at, p_cursor_id: 'id499' }),
    );
  });

  it('throws RPC errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    await expect(listInstagramContacts(F, 1)).rejects.toThrow('boom');
  });

  it('counts contacts with head+count', async () => {
    const select = vi.fn().mockResolvedValue({ count: 7, error: null });
    mockFrom.mockReturnValue({ select });
    expect(await countInstagramContacts()).toBe(7);
    expect(mockFrom).toHaveBeenCalledWith('instagram_automation_contacts');
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });
});
