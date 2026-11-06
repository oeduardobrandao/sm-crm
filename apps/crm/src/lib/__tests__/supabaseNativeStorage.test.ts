import { afterEach, describe, expect, it, vi } from 'vitest';

type CapacitorStub = { isNativePlatform?: () => boolean };

function setCapacitor(stub: CapacitorStub | undefined) {
  (window as unknown as { Capacitor?: CapacitorStub }).Capacitor = stub;
}

async function loadCreateClientArgs() {
  vi.resetModules();
  const createClient = vi.fn(() => ({ auth: {} }));
  vi.doMock('@supabase/supabase-js', () => ({ createClient }));
  await import('../supabase');
  return createClient.mock.calls[0] as unknown[];
}

afterEach(() => {
  setCapacitor(undefined);
  vi.doUnmock('@supabase/supabase-js');
});

describe('supabase client auth storage', () => {
  it('keeps supabase-js defaults on the web', async () => {
    const args = await loadCreateClientArgs();
    expect(args[2]).toBeUndefined();
  });

  it('uses the Keychain-backed storage inside the iOS app', async () => {
    setCapacitor({ isNativePlatform: () => true });
    const args = await loadCreateClientArgs();
    const options = args[2] as { auth?: { storage?: Record<string, unknown> } } | undefined;
    expect(typeof options?.auth?.storage?.getItem).toBe('function');
    expect(typeof options?.auth?.storage?.setItem).toBe('function');
    expect(typeof options?.auth?.storage?.removeItem).toBe('function');
  });
});
