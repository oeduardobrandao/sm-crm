import { vi } from 'vitest';

/**
 * Makes the page look like the iOS app binary with MesaasNative.shareFiles (1.0.1 build
 * 2 on). Returns the shareFiles mock; call `leaveNativeApp()` afterwards.
 */
export function asNativeShareBinary(
  shareFiles: (opts: unknown) => Promise<unknown> = async () => ({ completed: true }),
) {
  const fn = vi.fn(shareFiles);
  (window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: (name: string) => name === 'MesaasNative',
    PluginHeaders: [{ name: 'MesaasNative', methods: [{ name: 'shareFiles' }] }],
    Plugins: { MesaasNative: { shareFiles: fn } },
  };
  return fn;
}

export function leaveNativeApp() {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
}
