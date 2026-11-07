import { isNativeApp } from './platform';

/**
 * The app's own Capacitor plugin (apps/mobile/ios/App/App/MesaasNativePlugin.swift).
 * Method names and shapes must match the Swift side.
 */
export interface MesaasNativePlugin {
  keychainGet(options: { key: string }): Promise<{ value: string | null }>;
  keychainSet(options: { key: string; value: string }): Promise<void>;
  keychainRemove(options: { key: string }): Promise<void>;
  /** `pushEnvironment` comes from the build (#if DEBUG), never guessed in JS. */
  deviceInfo(): Promise<{ pushEnvironment: 'sandbox' | 'production'; appVersion: string }>;
  openSettings(): Promise<void>;
  /** Opens an https URL outside the web view (Safari). */
  openUrl(options: { url: string }): Promise<void>;
}

interface CapacitorPluginsBridge {
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown>;
}

/**
 * The plugin proxy the shell's bridge injects at document start, or null on the web
 * and on an older app binary that predates the plugin (a web deploy reaches installed
 * apps before an App Store update). Synchronous and import-free on purpose: the
 * Supabase session read goes through it and must never wait on a network chunk.
 */
export function getMesaasNative(): MesaasNativePlugin | null {
  if (!isNativeApp()) return null;
  const cap = (window as unknown as { Capacitor?: CapacitorPluginsBridge }).Capacitor;
  if (!cap?.isPluginAvailable?.('MesaasNative')) return null;
  return (cap.Plugins?.MesaasNative as MesaasNativePlugin | undefined) ?? null;
}
