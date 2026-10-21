import { beforeEach, describe, expect, it, vi } from 'vitest';

const { posthogMock, sdkImport } = vi.hoisted(() => ({
  // Counts reads of the SDK's default export, i.e. how many times analytics.ts actually imported
  // it. A factory-run counter would not work: Vitest caches the factory result across resetModules.
  sdkImport: { count: 0 },
  posthogMock: {
    init: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    group: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
}));

// Hoisted too: vi.mock is lifted above plain consts. Reused by the failed-download test to restore.
const { sdkModule } = vi.hoisted(() => ({
  sdkModule: () => ({
    get default() {
      sdkImport.count += 1;
      return posthogMock;
    },
  }),
}));

vi.mock('posthog-js', sdkModule);

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    posthogMock.has_opted_out_capturing.mockReset();
    posthogMock.has_opted_out_capturing.mockReturnValue(false);
    sdkImport.count = 0;
  });

  it('no-ops entirely when no key is configured', async () => {
    // Local dev and CI have no key. Analytics must never be a hard dependency of booting the app.
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const { initAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    captureEvent('client_created');
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('initialises against the EU host and only builds identified profiles', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
        capture_exceptions: true,
      }),
    );
  });

  it('captures events once initialised', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    captureEvent('hub_link_copied', { cliente_id: 7 });
    expect(posthogMock.capture).toHaveBeenCalledWith('hub_link_copied', { cliente_id: 7 });
  });

  it('bypasses request batching only when the call site is about to navigate away', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();

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
    await vi.dynamicImportSettled();
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
    await vi.dynamicImportSettled();
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: 'pro', role: 'owner' });
    expect(posthogMock.identify).toHaveBeenCalledWith('user-1', {
      workspace_id: 'ws-1',
      plan_id: 'pro',
      role: 'owner',
    });
    expect(posthogMock.group).toHaveBeenCalledWith('workspace', 'ws-1');
  });

  it('clears the ph_ identifier on opt-out by initialising with opt_out_persistence_by_default', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({ opt_out_persistence_by_default: true }),
    );
  });

  it('skips the feature-flag reload that reset() would fire with the pre-revoke device id', async () => {
    // reset() ends with reloadFeatureFlags(); its /flags POST is not gated on opt-out. The CRM uses
    // no flags. advanced_disable_flags must NOT be set: it would also stop remote config (replay).
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    const config = posthogMock.init.mock.calls[0][1];
    expect(config).toEqual(expect.objectContaining({ advanced_disable_feature_flags: true }));
    expect(config).not.toHaveProperty('advanced_disable_flags');
  });

  it('disableAnalytics resets BEFORE opting out (reset() deletes the opt-out flag)', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, disableAnalytics } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    disableAnalytics();
    expect(posthogMock.reset).toHaveBeenCalledTimes(1);
    expect(posthogMock.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(posthogMock.reset.mock.invocationCallOrder[0]).toBeLessThan(
      posthogMock.opt_out_capturing.mock.invocationCallOrder[0],
    );
  });

  it('every helper no-ops after disableAnalytics', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, disableAnalytics, captureEvent, identifySignup, identifyWorkspaceUser } =
      await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    disableAnalytics();
    posthogMock.reset.mockClear();
    captureEvent('client_created');
    identifySignup('user-1');
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: null, role: 'owner' });
    expect(posthogMock.capture).not.toHaveBeenCalled();
    expect(posthogMock.identify).not.toHaveBeenCalled();
    expect(posthogMock.group).not.toHaveBeenCalled();
  });

  it('accept, reject, accept initialises once and resumes with opt_in_capturing', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, disableAnalytics } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    disableAnalytics();
    posthogMock.has_opted_out_capturing.mockReturnValue(true);
    initAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
  });

  it('clears an opt-out flag left by a previous session on a fresh grant', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    posthogMock.has_opted_out_capturing.mockReturnValue(true);
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
  });

  it('does not opt in when the SDK is not opted out', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogMock.opt_in_capturing).not.toHaveBeenCalled();
  });

  it('replays the last workspace identity when capturing starts after the user was known', async () => {
    // AuthContext identifies once, during profile hydration. A mid-session grant (or the idle
    // boot init finishing after hydration) would otherwise leave the person permanently
    // anonymous under person_profiles: 'identified_only'.
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, identifyWorkspaceUser } = await import('../analytics');
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: null, role: 'owner' });
    expect(posthogMock.identify).not.toHaveBeenCalled();
    initAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogMock.identify).toHaveBeenCalledWith('user-1', {
      workspace_id: 'ws-1',
      plan_id: null,
      role: 'owner',
    });
    expect(posthogMock.group).toHaveBeenCalledWith('workspace', 'ws-1');
  });

  it('forgets the remembered identity on resetAnalytics so it is never replayed for the next user', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, identifyWorkspaceUser, resetAnalytics } = await import('../analytics');
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: null, role: 'owner' });
    resetAnalytics();
    initAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogMock.identify).not.toHaveBeenCalled();
  });

  it('disableAnalytics no-ops when analytics was never started', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { disableAnalytics } = await import('../analytics');
    disableAnalytics();
    expect(posthogMock.reset).not.toHaveBeenCalled();
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled();
  });

  it('never downloads posthog-js when no key is configured', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const { initAnalytics, captureEvent, identifySignup } = await import('../analytics');
    initAnalytics();
    captureEvent('client_created');
    identifySignup('user-1');
    await vi.dynamicImportSettled();
    expect(sdkImport.count).toBe(0);
  });

  it('does not download posthog-js until analytics is started', async () => {
    // The whole point of the dynamic import: the landing page must not pay for the SDK pre-consent.
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { captureEvent } = await import('../analytics');
    captureEvent('client_created');
    await vi.dynamicImportSettled();
    expect(sdkImport.count).toBe(0);
  });

  it('flushes calls made while the SDK was downloading, in order, right after init', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, captureEvent, identifySignup } = await import('../analytics');
    initAnalytics();
    identifySignup('user-1');
    captureEvent('signup_completed', { plan: 'pro' });
    captureEvent('checkout_started', undefined, { sendInstantly: true });
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
    await vi.dynamicImportSettled();
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.identify).toHaveBeenCalledWith('user-1');
    expect(posthogMock.capture.mock.calls).toEqual([
      ['signup_completed', { plan: 'pro' }],
      ['checkout_started', undefined, { send_instantly: true }],
    ]);
    // init precedes the flush, and identify (needed for identified_only) precedes the capture.
    expect(posthogMock.init.mock.invocationCallOrder[0]).toBeLessThan(
      posthogMock.identify.mock.invocationCallOrder[0],
    );
    expect(posthogMock.identify.mock.invocationCallOrder[0]).toBeLessThan(
      posthogMock.capture.mock.invocationCallOrder[0],
    );
  });

  it('replays a known identity before events queued during the download', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, identifyWorkspaceUser, captureEvent } = await import('../analytics');
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: null, role: 'owner' });
    initAnalytics();
    captureEvent('client_created');
    await vi.dynamicImportSettled();
    expect(posthogMock.identify).toHaveBeenCalledTimes(1);
    expect(posthogMock.identify.mock.invocationCallOrder[0]).toBeLessThan(
      posthogMock.capture.mock.invocationCallOrder[0],
    );
  });

  it('a revoke before the SDK finishes downloading prevents init and drops the queue', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, disableAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    captureEvent('client_created');
    disableAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
    // Never initialised, so there is nothing to reset or opt out of.
    expect(posthogMock.reset).not.toHaveBeenCalled();
    expect(posthogMock.opt_out_capturing).not.toHaveBeenCalled();

    // A later re-grant still starts analytics normally.
    initAnalytics();
    captureEvent('lead_created');
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.capture.mock.calls).toEqual([['lead_created', undefined]]);
  });

  it('a revoke and re-grant during the download initialises once', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, disableAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    captureEvent('client_created');
    disableAnalytics();
    initAnalytics();
    captureEvent('lead_created');
    await vi.dynamicImportSettled();
    expect(sdkImport.count).toBe(1);
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    // The pre-revoke event was dropped with the queue.
    expect(posthogMock.capture.mock.calls).toEqual([['lead_created', undefined]]);
  });

  it('swallows a failed SDK download and retries on the next initAnalytics', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    // A chunk download that dies the way a dropped mobile connection would.
    vi.doMock('posthog-js', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { initAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    captureEvent('client_created');
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(posthogMock.init).not.toHaveBeenCalled();
    // Back to "not started": helpers no-op instead of queueing against a dead download.
    captureEvent('lead_created');

    vi.doMock('posthog-js', sdkModule);
    initAnalytics();
    await vi.dynamicImportSettled();
    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    captureEvent('task_created');
    expect(posthogMock.capture.mock.calls).toEqual([['task_created', undefined]]);
  });
});
