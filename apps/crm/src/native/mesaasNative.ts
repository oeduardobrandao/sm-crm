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
  /**
   * Downloads the files natively and opens the share sheet with them. Rejects with
   * "HTTP <status>" when the server refuses one. Older app binaries lack it: check
   * `hasMesaasNativeMethod('shareFiles')` first.
   */
  shareFiles(options: {
    files: { url: string; filename: string }[];
  }): Promise<{ completed: boolean }>;
}

interface CapacitorPluginsBridge {
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown>;
  PluginHeaders?: { name: string; methods?: { name: string }[] }[];
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

/**
 * Whether this app binary implements `method`. The plugin proxy answers every name, so
 * a method an older binary lacks only fails when called; the bridge's plugin headers
 * list what the Swift side actually registered.
 */
export function hasMesaasNativeMethod(method: keyof MesaasNativePlugin): boolean {
  if (getMesaasNative() === null) return false;
  const cap = (window as unknown as { Capacitor?: CapacitorPluginsBridge }).Capacitor;
  const header = cap?.PluginHeaders?.find((h) => h.name === 'MesaasNative');
  return header?.methods?.some((m) => m.name === method) === true;
}
