import { afterEach, describe, expect, it } from 'vitest';
import { isNativeApp, nativePlatform } from '../platform';
import { getMesaasNative } from '../mesaasNative';

type CapacitorStub = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown>;
};

function setCapacitor(stub: CapacitorStub | undefined) {
  (window as unknown as { Capacitor?: CapacitorStub }).Capacitor = stub;
}

afterEach(() => setCapacitor(undefined));

describe('isNativeApp / nativePlatform', () => {
  it('is false on the web (no bridge)', () => {
    expect(isNativeApp()).toBe(false);
    expect(nativePlatform()).toBeNull();
  });

  it('is true inside the iOS shell', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    expect(isNativeApp()).toBe(true);
    expect(nativePlatform()).toBe('ios');
  });

  it('is false when the bridge reports the web platform', () => {
    setCapacitor({ isNativePlatform: () => false, getPlatform: () => 'web' });
    expect(isNativeApp()).toBe(false);
    expect(nativePlatform()).toBeNull();
  });

  it('ignores an unknown platform name', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'electron' });
    expect(nativePlatform()).toBeNull();
  });
});

describe('getMesaasNative', () => {
  it('is null on the web', () => {
    expect(getMesaasNative()).toBeNull();
  });

  it('is null on an older binary without the plugin', () => {
    setCapacitor({ isNativePlatform: () => true, isPluginAvailable: () => false, Plugins: {} });
    expect(getMesaasNative()).toBeNull();
  });

  it('returns the injected plugin proxy when available', () => {
    const plugin = { keychainGet: async () => ({ value: null }) };
    setCapacitor({
      isNativePlatform: () => true,
      isPluginAvailable: (name) => name === 'MesaasNative',
      Plugins: { MesaasNative: plugin },
    });
    expect(getMesaasNative()).toBe(plugin);
  });
});
