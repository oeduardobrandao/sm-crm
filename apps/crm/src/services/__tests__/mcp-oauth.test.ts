import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

import { supabase } from '../../lib/supabase';
import {
  listEligibleWorkspaces,
  recordOAuthGrant,
  listOAuthGrants,
  revokeOAuthGrant,
} from '../mcp-oauth';

type FetchMock = ReturnType<typeof vi.fn>;
const calls = () => (fetch as unknown as FetchMock).mock.calls;
const sentBody = (i = 0) => JSON.parse(calls()[i][1].body);

function mockFetch(body: unknown, ok = true, status = 200) {
  (fetch as unknown as FetchMock).mockResolvedValue({ ok, status, json: async () => body });
}

describe('mcp-oauth service', () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok' } },
    } as never);
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  });

  it('listEligibleWorkspaces hits the consent fn and returns workspaces', async () => {
    mockFetch({ workspaces: [{ id: 'c1', name: 'X', role: 'owner', feature_mcp: true }] });
    const ws = await listEligibleWorkspaces();
    expect(ws).toEqual([{ id: 'c1', name: 'X', role: 'owner', feature_mcp: true }]);
    expect(calls()[0][0]).toContain('/functions/v1/mcp-oauth-consent');
    expect(sentBody()).toEqual({ action: 'eligible-workspaces' });
    expect(calls()[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('recordOAuthGrant posts approve with authorization_id and never client_id', async () => {
    mockFetch({ ok: true });
    await recordOAuthGrant({ authorization_id: 'a1', conta_id: 'c1', scopes: ['posts:read'] });
    const sent = sentBody();
    expect(sent).toEqual({
      action: 'approve',
      authorization_id: 'a1',
      conta_id: 'c1',
      scopes: ['posts:read'],
    });
    expect(sent).not.toHaveProperty('client_id');
  });

  it('listOAuthGrants returns the grants array', async () => {
    mockFetch({
      grants: [
        {
          id: 'g1',
          client_id: 'cl',
          scopes: ['posts:read'],
          created_at: 't',
          revoked_at: null,
          connected_by: 'Eduardo',
        },
      ],
    });
    const grants = await listOAuthGrants();
    expect(grants).toHaveLength(1);
    expect(grants[0].connected_by).toBe('Eduardo');
    expect(sentBody()).toEqual({ action: 'list-grants' });
  });

  it('revokeOAuthGrant posts revoke-grant with grant_id', async () => {
    mockFetch({ ok: true });
    await revokeOAuthGrant('g1');
    expect(sentBody()).toEqual({ action: 'revoke-grant', grant_id: 'g1' });
  });

  it('throws the server error message on non-ok', async () => {
    mockFetch({ error: 'Insufficient permissions' }, false, 403);
    await expect(listOAuthGrants()).rejects.toThrow('Insufficient permissions');
  });
});
