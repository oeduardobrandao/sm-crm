// Is the CRM running inside the Mesaas iOS app (apps/mobile)?
//
// The app's web view loads the live CRM (apps/mobile/DECISIONS.md D3), and the
// Capacitor shell injects `window.Capacitor` before any page script runs. Reading
// that global is all this module does: no imports and nothing at module scope, so
// it is safe in the SSR prerender (Node) and adds nothing to public bundles.

export type NativePlatform = 'ios' | 'android';

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function bridge(): CapacitorBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
}

export function isNativeApp(): boolean {
  return bridge()?.isNativePlatform?.() === true;
}

export function nativePlatform(): NativePlatform | null {
  if (!isNativeApp()) return null;
  const p = bridge()?.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : null;
}
