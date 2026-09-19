import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedConsent } from '../../test/consent';

const m = vi.hoisted(() => ({
  initAnalytics: vi.fn(),
  disableAnalytics: vi.fn(),
  loadCrisp: vi.fn(),
  loadCrispWhenIdle: vi.fn(),
  purgeAnalyticsStorage: vi.fn(),
  purgeSupportStorage: vi.fn(),
  resumePendingSupportChat: vi.fn(),
}));
vi.mock('../analytics', () => ({
  initAnalytics: m.initAnalytics,
  disableAnalytics: m.disableAnalytics,
}));
vi.mock('../crispLoader', () => ({
  loadCrisp: m.loadCrisp,
  loadCrispWhenIdle: m.loadCrispWhenIdle,
}));
vi.mock('../legacyStorage', () => ({
  purgeAnalyticsStorage: m.purgeAnalyticsStorage,
  purgeSupportStorage: m.purgeSupportStorage,
}));
vi.mock('../supportChat', () => ({ resumePendingSupportChat: m.resumePendingSupportChat }));

async function boot() {
  const consent = await import('../consent');
  const { installConsentEffects } = await import('../consentEffects');
  installConsentEffects();
  return consent;
}

describe('installConsentEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('loads nothing and purges legacy storage when the visitor is undecided', async () => {
    await boot();
    vi.advanceTimersByTime(5000);
    expect(m.initAnalytics).not.toHaveBeenCalled();
    expect(m.loadCrisp).not.toHaveBeenCalled();
    expect(m.loadCrispWhenIdle).not.toHaveBeenCalled();
    expect(m.purgeAnalyticsStorage).toHaveBeenCalledTimes(1);
    expect(m.purgeSupportStorage).toHaveBeenCalledTimes(1);
  });

  it('defers both tools to idle at boot when consent is already stored', async () => {
    seedConsent({ analytics: true, support: true });
    await boot();
    expect(m.initAnalytics).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(m.initAnalytics).toHaveBeenCalledTimes(1);
    expect(m.loadCrispWhenIdle).toHaveBeenCalledTimes(1);
    expect(m.purgeAnalyticsStorage).not.toHaveBeenCalled();
    expect(m.purgeSupportStorage).not.toHaveBeenCalled();
  });

  it('does not start analytics if consent is revoked before the deferred boot init fires', async () => {
    seedConsent({ analytics: true, support: true });
    const { setConsent } = await boot();
    setConsent({ analytics: false, support: false });
    vi.advanceTimersByTime(5000);
    expect(m.initAnalytics).not.toHaveBeenCalled();
  });

  it('starts analytics immediately when the visitor accepts after boot', async () => {
    const { setConsent } = await boot();
    setConsent({ analytics: true, support: false });
    expect(m.initAnalytics).toHaveBeenCalledTimes(1);
    expect(m.loadCrisp).not.toHaveBeenCalled();
  });

  it('loads Crisp immediately on a later support grant and resumes a blocked chat click', async () => {
    const { setConsent } = await boot();
    setConsent({ analytics: false, support: true });
    expect(m.loadCrisp).toHaveBeenCalledTimes(1);
    expect(m.resumePendingSupportChat).toHaveBeenCalledTimes(1);
  });

  it('on analytics revoke: disables PostHog, then purges its storage', async () => {
    const { setConsent } = await boot();
    setConsent({ analytics: true, support: false });
    m.purgeAnalyticsStorage.mockClear();
    setConsent({ analytics: false, support: false });
    expect(m.disableAnalytics).toHaveBeenCalledTimes(1);
    expect(m.purgeAnalyticsStorage).toHaveBeenCalledTimes(1);
    expect(m.disableAnalytics.mock.invocationCallOrder[0]).toBeLessThan(
      m.purgeAnalyticsStorage.mock.invocationCallOrder[0],
    );
  });

  it('does NOT tear Crisp down on support revoke (AuthContext owns that ordering)', async () => {
    const { setConsent } = await boot();
    setConsent({ analytics: false, support: true });
    m.purgeSupportStorage.mockClear();
    setConsent({ analytics: false, support: false });
    expect(m.purgeSupportStorage).not.toHaveBeenCalled();
  });

  it('does not purge repeatedly for an unrelated change', async () => {
    const { setConsent } = await boot();
    m.purgeAnalyticsStorage.mockClear();
    setConsent({ analytics: false, support: true });
    expect(m.purgeAnalyticsStorage).not.toHaveBeenCalled();
  });
});
