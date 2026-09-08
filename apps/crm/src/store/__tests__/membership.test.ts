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
      // The column list is forwarded to the mock so the pre-migration
      // fallback tests below can answer the enriched select and the legacy
      // select differently. Tests that don't care still work: a plain
      // mockResolvedValue ignores the argument.
      select: (columns: string) => ({
        eq: () => ({ eq: () => ({ maybeSingle: () => mockMaybeSingle(columns) }) }),
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
      data: { role: 'admin', can_see_financials: false, role_id: null, workspace_roles: null },
      error: null,
    });
    await expect(getMyMembership()).resolves.toEqual({
      role: 'admin',
      can_see_financials: false,
      role_id: null,
      permissions: null,
    });
  });

  it('flattens the workspace_roles embed into a top-level permissions map for a custom role', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        role: 'agent',
        can_see_financials: false,
        role_id: 'role-1',
        workspace_roles: { permissions: { leads: 'editar' } },
      },
      error: null,
    });
    await expect(getMyMembership()).resolves.toEqual({
      role: 'agent',
      can_see_financials: false,
      role_id: 'role-1',
      permissions: { leads: 'editar' },
    });
  });

  it('returns null when there is no membership row', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getMyMembership()).resolves.toBeNull();
  });

  it('throws on a query error so the caller can resolve to unknown', async () => {
    const queryError = { message: 'boom' };
    mockMaybeSingle.mockResolvedValue({ data: null, error: queryError });
    await expect(getMyMembership()).rejects.toBe(queryError);
  });

  // Pre-migration fallback (2026-09-02 incident): the bundle can reach a
  // database that doesn't have role_id/workspace_roles yet, because Vercel
  // deploys on merge while migrations are pushed by hand. The enriched
  // select 400s there for EVERY member — without the fallback, AuthContext
  // resolved membership to 'error' and the whole app showed "Não foi
  // possível confirmar seu acesso".
  const schemaCacheError = {
    code: 'PGRST200',
    message:
      "Could not find a relationship between 'workspace_members' and 'workspace_roles' in the schema cache",
  };

  it('falls back to the legacy select when the roles schema is missing (pre-migration DB)', async () => {
    mockMaybeSingle.mockImplementation((columns: string) =>
      columns.includes('workspace_roles')
        ? Promise.resolve({ data: null, error: schemaCacheError })
        : Promise.resolve({ data: { role: 'owner', can_see_financials: true }, error: null }),
    );
    await expect(getMyMembership()).resolves.toEqual({
      role: 'owner',
      can_see_financials: true,
      role_id: null,
      permissions: null,
    });
  });

  it('resolves to null (not a throw) when the fallback finds no row', async () => {
    mockMaybeSingle.mockImplementation((columns: string) =>
      columns.includes('workspace_roles')
        ? Promise.resolve({ data: null, error: { code: '42703', message: 'column x' } })
        : Promise.resolve({ data: null, error: null }),
    );
    await expect(getMyMembership()).resolves.toBeNull();
  });

  it('does not retry on a non-schema error — a network blip must still resolve to unknown', async () => {
    const transportError = { message: 'TypeError: Failed to fetch' };
    mockMaybeSingle.mockResolvedValue({ data: null, error: transportError });
    await expect(getMyMembership()).rejects.toBe(transportError);
    // One select only: retrying the same failing transport would just double
    // the latency of every hydration during an outage.
    expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it('throws the legacy error when the fallback itself fails', async () => {
    const legacyError = { message: 'permission denied' };
    mockMaybeSingle.mockImplementation((columns: string) =>
      columns.includes('workspace_roles')
        ? Promise.resolve({ data: null, error: schemaCacheError })
        : Promise.resolve({ data: null, error: legacyError }),
    );
    await expect(getMyMembership()).rejects.toBe(legacyError);
  });
});
