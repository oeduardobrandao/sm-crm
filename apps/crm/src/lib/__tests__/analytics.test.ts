import { beforeEach, describe, expect, it, vi } from 'vitest';

const { posthogMock } = vi.hoisted(() => ({
  posthogMock: {
    init: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    group: vi.fn(),
  },
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('no-ops entirely when no key is configured', async () => {
    // Local dev and CI have no key. Analytics must never be a hard dependency of booting the app.
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const { initAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    captureEvent('client_created');
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('initialises against the EU host and only builds identified profiles', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
      }),
    );
  });

  it('captures events once initialised', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    captureEvent('hub_link_copied', { cliente_id: 7 });
    expect(posthogMock.capture).toHaveBeenCalledWith('hub_link_copied', { cliente_id: 7 });
  });

  it('bypasses request batching only when the call site is about to navigate away', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();

    // Default path stays two-arg: posthog-js batches, which is what we want everywhere else.
    captureEvent('client_created');
    expect(posthogMock.capture).toHaveBeenLastCalledWith('client_created', undefined);

    captureEvent('checkout_started', { plan_id: 'pro' }, { sendInstantly: true });
    expect(posthogMock.capture).toHaveBeenLastCalledWith(
      'checkout_started',
      { plan_id: 'pro' },
      { send_instantly: true },
    );
  });

  it('identifies a signup with the bare uuid so signup_completed attaches to a person', async () => {
    // Under identified_only, an anonymous capture is personless forever. identifySignup must
    // create the person (uuid only, no email/name) before signup_completed fires.
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, identifySignup } = await import('../analytics');
    initAnalytics();
    identifySignup('user-1');
    expect(posthogMock.identify).toHaveBeenCalledWith('user-1');
  });

  it('identifySignup no-ops when analytics is not configured', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const { identifySignup } = await import('../analytics');
    identifySignup('user-1');
    expect(posthogMock.identify).not.toHaveBeenCalled();
  });

  it('groups the user by workspace, because retention is a workspace property', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, identifyWorkspaceUser } = await import('../analytics');
    initAnalytics();
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: 'pro', role: 'owner' });
    expect(posthogMock.identify).toHaveBeenCalledWith('user-1', {
      workspace_id: 'ws-1',
      plan_id: 'pro',
      role: 'owner',
    });
    expect(posthogMock.group).toHaveBeenCalledWith('workspace', 'ws-1');
  });
});
