import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories run before any of this file's own top-level statements
// (the import of '../workspace' below pulls in '../core', which triggers the
// factory, and ESM import evaluation runs ahead of local const initializers).
// vi.hoisted() guarantees these are ready before that happens; plain
// `const mock... = vi.fn()` above the vi.mock call left `mockGetContaId`
// in the TDZ when the factory actually ran.
const { mockMaybeSingle, mockGetContaId, mockGetUser } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
  mockGetContaId: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
      }),
    }),
  },
  getContaId: mockGetContaId,
  getUserId: vi.fn().mockResolvedValue('u1'),
}));

import { getMyMembership } from '../workspace';

describe('getMyMembership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Global test setup (test/vitest.setup.ts) runs vi.restoreAllMocks() in
    // afterEach, which wipes any implementation set only once inside the
    // vi.mock factory above. Re-arm every test-file-scoped mock here instead
    // of relying on the factory's one-time value surviving past test 1.
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockGetContaId.mockResolvedValue('ws-1');
  });

  it('returns the membership row for the active workspace', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'admin', can_see_financials: false },
      error: null,
    });
    await expect(getMyMembership()).resolves.toEqual({
      role: 'admin',
      can_see_financials: false,
    });
  });

  it('returns null when there is no membership row', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getMyMembership()).resolves.toBeNull();
  });

  it('throws on a query error so the caller can resolve to unknown', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getMyMembership()).rejects.toBeTruthy();
  });
});
