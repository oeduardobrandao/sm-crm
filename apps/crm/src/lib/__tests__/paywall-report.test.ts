import { describe, expect, it, vi, beforeEach } from 'vitest';

// reportPaywallHit sends the current session's access token as a bearer
// token (the paywall-report endpoint authorises off it). The real supabase
// client resolves getSession() to a null session in jsdom (no local storage
// entry), which would make every fetch-based assertion below a false
// negative. Mocked here the same way services/__tests__/billing.test.ts
// mocks it, so the dedupe/report logic under test is exercised with a token
// present, like it would be for a real logged-in user.
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

import { supabase } from '../supabase';
import { __resetPaywallReportDedupe, reportPaywallHit } from '../paywall-report';

describe('reportPaywallHit', () => {
  beforeEach(() => {
    __resetPaywallReportDedupe();
    vi.restoreAllMocks();
    // The global afterEach runs vi.restoreAllMocks(), so re-establish the
    // session mock implementation before every test.
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok' } },
    } as never);
  });

  it('posts workspace_id and feature once per session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_hub_portal' });
    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_hub_portal' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      workspace_id: 'ws-1',
      feature: 'feature_hub_portal',
      clicked_upgrade: false,
    });
  });

  it('treats a different feature on the same workspace as a distinct report', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_leads' });
    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_ideas' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('always sends an upgrade click, even after the render was already reported', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_leads' });
    reportPaywallHit({ workspaceId: 'ws-1', feature: 'feature_leads', clickedUpgrade: true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).clicked_upgrade).toBe(true);
  });

  it('never throws when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(() => reportPaywallHit({ workspaceId: 'ws-1', feature: 'f' })).not.toThrow();
  });
});
