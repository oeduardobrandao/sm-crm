import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories run before any of this file's own top-level statements
// (the import of '../workspace' below pulls in '../core', which triggers the
// factory, and ESM import evaluation runs ahead of local const initializers).
// vi.hoisted() guarantees these are ready before that happens; plain
// `const mock... = vi.fn()` above the vi.mock call left `mockGetContaId`
// in the TDZ when the factory actually ran.
const {
  mockMaybeSingle,
  mockGetContaId,
  mockGetUser,
  mockAssignments,
  mockAssignmentEqs,
  mockGetSession,
} = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
  mockGetContaId: vi.fn(),
  mockGetUser: vi.fn(),
  // workspace_member_clientes read (getMemberClienteIds): resolved by
  // awaiting the builder after the last .eq().
  mockAssignments: vi.fn(),
  mockAssignmentEqs: [] as Array<[string, unknown]>,
  mockGetSession: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: {
    auth: { getUser: mockGetUser, getSession: mockGetSession },
    from: (table: string) =>
      table === 'workspace_member_clientes'
        ? {
            select: () => ({
              eq: (c1: string, v1: unknown) => {
                mockAssignmentEqs.push([c1, v1]);
                return {
                  eq: (c2: string, v2: unknown) => {
                    mockAssignmentEqs.push([c2, v2]);
                    return mockAssignments();
                  },
                };
              },
            }),
          }
        : {
            // The column list is forwarded to the mock so the pre-migration
            // fallback tests below can answer the enriched select and the legacy
            // select differently. Tests that don't care still work: a plain
            // mockResolvedValue ignores the argument.
            select: (columns: string) => ({
              eq: () => ({ eq: () => ({ maybeSingle: () => mockMaybeSingle(columns) }) }),
            }),
          },
  },
  getContaId: mockGetContaId,
  getUserId: vi.fn().mockResolvedValue('u1'),
}));

import { getMyMembership, getMemberClienteIds, setWorkspaceUserClientScope } from '../workspace';

// Fields every MyMembership carries when the client-scope schema is absent or
// the row is unrestricted.
const UNSCOPED = { client_scope: 'todos', client_scope_rev: 0, cliente_ids: [] };

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
      ...UNSCOPED,
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
      ...UNSCOPED,
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
      ...UNSCOPED,
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

  // ---- Acesso por cliente (client_scope) ----

  it('reads client_scope, client_scope_rev and the workspace_member_clientes embed', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        role: 'agent',
        can_see_financials: false,
        role_id: null,
        workspace_roles: null,
        client_scope: 'atribuidos',
        client_scope_rev: 4,
        workspace_member_clientes: [{ cliente_id: 7 }, { cliente_id: 9 }],
      },
      error: null,
    });
    await expect(getMyMembership()).resolves.toEqual({
      role: 'agent',
      can_see_financials: false,
      role_id: null,
      permissions: null,
      client_scope: 'atribuidos',
      client_scope_rev: 4,
      cliente_ids: [7, 9],
    });
    expect(mockMaybeSingle.mock.calls[0][0]).toContain('client_scope');
    expect(mockMaybeSingle.mock.calls[0][0]).toContain('client_scope_rev');
    expect(mockMaybeSingle.mock.calls[0][0]).toContain('workspace_member_clientes(cliente_id)');
  });

  it('membership_embed_error_with_atribuidos_yields_empty_ids', async () => {
    // The column exists and says 'atribuidos', but the embed relationship is
    // missing (PostgREST fails the whole request on a bad embed). The
    // step-down select without the embed must yield ZERO ids, never "all".
    mockMaybeSingle.mockImplementation((columns: string) =>
      columns.includes('workspace_member_clientes')
        ? Promise.resolve({
            data: null,
            error: {
              code: 'PGRST200',
              message:
                "Could not find a relationship between 'workspace_members' and 'workspace_member_clientes' in the schema cache",
            },
          })
        : Promise.resolve({
            data: {
              role: 'agent',
              can_see_financials: false,
              role_id: 'role-1',
              workspace_roles: { permissions: { clientes: 'editar' } },
              client_scope: 'atribuidos',
              client_scope_rev: 2,
            },
            error: null,
          }),
    );
    await expect(getMyMembership()).resolves.toEqual({
      role: 'agent',
      can_see_financials: false,
      role_id: 'role-1',
      permissions: { clientes: 'editar' },
      client_scope: 'atribuidos',
      client_scope_rev: 2,
      cliente_ids: [],
    });
  });

  it('a null embed with atribuidos yields empty ids, never all', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        role: 'agent',
        can_see_financials: false,
        role_id: null,
        workspace_roles: null,
        client_scope: 'atribuidos',
        client_scope_rev: 1,
        workspace_member_clientes: null,
      },
      error: null,
    });
    const m = await getMyMembership();
    expect(m?.client_scope).toBe('atribuidos');
    expect(m?.cliente_ids).toEqual([]);
  });

  it('a null client_scope fails closed to atribuidos', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        role: 'agent',
        can_see_financials: false,
        role_id: null,
        workspace_roles: null,
        client_scope: null,
        client_scope_rev: 1,
        workspace_member_clientes: [],
      },
      error: null,
    });
    const m = await getMyMembership();
    expect(m?.client_scope).toBe('atribuidos');
  });

  it('pre-migration DB (no client_scope column) keeps the roles select and resolves as todos, rev 0, []', async () => {
    // Today's prod: roles schema present, client-scope schema absent. Must
    // step down to the roles select (keeping role_id/permissions), never to
    // the legacy select, which would zero a custom role (fail-open).
    mockMaybeSingle.mockImplementation((columns: string) =>
      columns.includes('client_scope')
        ? Promise.resolve({
            data: null,
            error: {
              code: '42703',
              message: 'column workspace_members.client_scope does not exist',
            },
          })
        : Promise.resolve({
            data: {
              role: 'agent',
              can_see_financials: false,
              role_id: 'role-1',
              workspace_roles: { permissions: { leads: 'ver' } },
            },
            error: null,
          }),
    );
    await expect(getMyMembership()).resolves.toEqual({
      role: 'agent',
      can_see_financials: false,
      role_id: 'role-1',
      permissions: { leads: 'ver' },
      ...UNSCOPED,
    });
    // The roles select (with workspace_roles) answered, not the legacy one.
    const answered = mockMaybeSingle.mock.calls.map((c) => c[0] as string);
    expect(answered.at(-1)).toContain('workspace_roles');
    expect(answered.at(-1)).not.toContain('client_scope');
  });

  it('a transport error on the full select still throws (no step-down)', async () => {
    const transportError = { message: 'TypeError: Failed to fetch' };
    mockMaybeSingle.mockResolvedValue({ data: null, error: transportError });
    await expect(getMyMembership()).rejects.toBe(transportError);
    expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
  });
});

describe('getMemberClienteIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssignmentEqs.length = 0;
    mockGetContaId.mockResolvedValue('ws-1');
  });

  it('reads the member assignments of the active workspace', async () => {
    mockAssignments.mockResolvedValue({
      data: [{ cliente_id: 3 }, { cliente_id: 11 }],
      error: null,
    });
    await expect(getMemberClienteIds('u-9')).resolves.toEqual([3, 11]);
    expect(mockAssignmentEqs).toEqual([
      ['workspace_id', 'ws-1'],
      ['user_id', 'u-9'],
    ]);
  });

  it('throws on error instead of returning a list', async () => {
    const err = { message: 'permission denied' };
    mockAssignments.mockResolvedValue({ data: null, error: err });
    await expect(getMemberClienteIds('u-9')).rejects.toBe(err);
  });
});

describe('setWorkspaceUserClientScope', () => {
  it('posts set-client-scope with scope and clienteIds to manage-workspace-user', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    // callManageWorkspaceUser reads the session for the bearer token.
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });

    await setWorkspaceUserClientScope('u-2', 'atribuidos', [4, 5]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/manage-workspace-user');
    expect(JSON.parse(init.body)).toEqual({
      action: 'set-client-scope',
      targetUserId: 'u-2',
      scope: 'atribuidos',
      clienteIds: [4, 5],
    });
    vi.unstubAllGlobals();
  });

  it('rejects when the edge function answers an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: 'Apenas o dono' }),
      }),
    );
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    await expect(setWorkspaceUserClientScope('u-2', 'todos', [])).rejects.toThrow('Apenas o dono');
    vi.unstubAllGlobals();
  });
});
