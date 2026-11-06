import type { PluginListenerHandle } from '@capacitor/core';
import type { ActionPerformed, PushNotificationsPlugin } from '@capacitor/push-notifications';
import { supabase } from '../lib/supabase';
import { isNativeApp } from './platform';
import { getMesaasNative } from './mesaasNative';
import { isBlockedInNativeApp } from './blockedPaths';

// Push notifications in the iOS app (apps/mobile PLAN.md D3): permission, device
// registration, unregister on logout and what a tap on a notification does.
//
// AuthContext imports this module, and the entry (and the SSR prerender) imports
// AuthContext: nothing here touches `window`, `localStorage` or `@capacitor/*` at module
// scope. The plugin is reached only through `import()` inside functions that first
// checked the shell's bridge, so the web bundles never load it. Every exported async
// function resolves; a failure here must never break login, logout or a page.

export type PushPermission = 'granted' | 'denied' | 'prompt';

/** Payload keys next to `aps` (notification-push-cron buildPushMessage). */
export interface PushTapData {
  link?: unknown;
  notification_id?: unknown;
}

export interface PushTapDeps {
  navigate(path: string): void;
  markRead(id: string): Promise<void>;
  refreshNotifications(): void;
}

/** Keychain key of this device's APNs token (kept across users of the phone). */
export const PUSH_TOKEN_KEY = 'mesaas.pushToken';
export const PRE_PROMPT_SNOOZE_KEY = 'mesaas.pushPrePrompt.snoozedUntil';
export const PRE_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function warn(message: string, error?: unknown): void {
  console.warn(`[push] ${message}`, error);
}

/** Inside the app, with both plugins in the running binary (an older one may lack them). */
export function isNativePushAvailable(): boolean {
  if (!isNativeApp() || getMesaasNative() === null) return false;
  try {
    const cap = (
      window as unknown as { Capacitor?: { isPluginAvailable?: (n: string) => boolean } }
    ).Capacitor;
    return cap?.isPluginAvailable?.('PushNotifications') === true;
  } catch {
    return false;
  }
}

// One import for the whole session (several callers start at mount); a failed chunk
// load is forgotten so the next call retries.
let pluginModule: Promise<typeof import('@capacitor/push-notifications')> | null = null;

// Returns the plugin wrapped in an object on purpose. Capacitor plugins are proxies
// that turn ANY property into a native call, `then` included, so resolving an async
// function with the bare plugin makes the promise call `plugin.then(...)` and never
// settle. Never return (or await) a plugin object itself.
async function loadPushPlugin(): Promise<{ plugin: PushNotificationsPlugin } | null> {
  if (!isNativePushAvailable()) return null;
  try {
    pluginModule ??= import('@capacitor/push-notifications');
    const mod = await pluginModule;
    return { plugin: mod.PushNotifications };
  } catch (error) {
    pluginModule = null;
    warn('plugin load failed', error);
    return null;
  }
}

// ---- Listeners ---------------------------------------------------------------------
//
// APNs answers register() with a `registration` event that the bridge does not retain,
// so the listener must exist before any register() call. It is a module singleton:
// syncNativePush/enableNativePush create it on demand, and NativeBridge holds it through
// attachNativePushListeners (counted, so a remount in StrictMode never drops it).

let registrationListeners: Promise<PluginListenerHandle[]> | null = null;
let attachCount = 0;

function ensureRegistrationListeners(
  plugin: PushNotificationsPlugin,
): Promise<PluginListenerHandle[]> {
  if (!registrationListeners) {
    const pending = Promise.all([
      plugin.addListener('registration', (token) => {
        void onRegistration(token.value);
      }),
      plugin.addListener('registrationError', (error) => warn('registration error', error?.error)),
    ]);
    registrationListeners = pending;
    pending.catch(() => {
      if (registrationListeners === pending) registrationListeners = null;
    });
  }
  return registrationListeners;
}

function tapDataOf(action: ActionPerformed | undefined): PushTapData {
  const data: unknown = action?.notification?.data;
  return data !== null && typeof data === 'object' ? (data as PushTapData) : {};
}

/**
 * Adds the `registration`, `registrationError` and tap listeners. Resolves to a detach
 * function that removes the tap listener, and the registration pair when no other
 * mount still holds it. Never rejects.
 */
export async function attachNativePushListeners(
  onTap: (data: PushTapData) => void,
): Promise<() => Promise<void>> {
  // Counted before the first await, so a mount that starts while another one is
  // detaching keeps the shared registration listener alive.
  attachCount += 1;
  let detached = false;
  const release = (): boolean => {
    if (detached) return false;
    detached = true;
    attachCount -= 1;
    return true;
  };

  const plugin = (await loadPushPlugin())?.plugin;
  if (!plugin) {
    return async () => {
      release();
    };
  }

  // Settled separately: a failed registration pair must not lose the tap handle (it
  // would never be removed).
  const [registration, tapResult] = await Promise.allSettled([
    ensureRegistrationListeners(plugin),
    plugin.addListener('pushNotificationActionPerformed', (action) => onTap(tapDataOf(action))),
  ]);
  if (registration.status === 'rejected') warn('listener setup failed', registration.reason);
  const tap = tapResult.status === 'fulfilled' ? tapResult.value : null;
  if (tapResult.status === 'rejected') warn('tap listener setup failed', tapResult.reason);

  return async () => {
    if (!release()) return;
    const removals: Promise<void>[] = [];
    if (tap) removals.push(tap.remove());
    const shared = registrationListeners;
    if (attachCount === 0 && shared) {
      registrationListeners = null;
      try {
        for (const handle of await shared) removals.push(handle.remove());
      } catch {
        // Never attached: nothing to remove.
      }
    }
    await Promise.allSettled(removals);
  };
}

// ---- Permission and registration ---------------------------------------------------

/** iOS notification permission; 'denied' when the plugin cannot be reached. */
export async function getPushPermission(): Promise<PushPermission> {
  const plugin = (await loadPushPlugin())?.plugin;
  if (!plugin) return 'denied';
  try {
    const { receive } = await plugin.checkPermissions();
    if (receive === 'granted') return 'granted';
    if (receive === 'denied') return 'denied';
    return 'prompt';
  } catch (error) {
    warn('checkPermissions failed', error);
    return 'denied';
  }
}

async function registerDevice(token: string): Promise<void> {
  const native = getMesaasNative();
  if (!native) return;
  // The environment comes from the build (#if DEBUG), never guessed here.
  const { pushEnvironment, appVersion } = await native.deviceInfo();
  const { error } = await supabase.rpc('register_push_device', {
    p_token: token,
    p_platform: 'ios',
    p_environment: pushEnvironment,
    p_app_version: appVersion,
  });
  if (error) throw error;
}

/** APNs gave this device a token: keep it in the Keychain and attach it to the user. */
export async function onRegistration(token: string): Promise<void> {
  const native = getMesaasNative();
  if (!native || !token) return;
  try {
    await native.keychainSet({ key: PUSH_TOKEN_KEY, value: token });
  } catch (error) {
    warn('keychain write failed', error);
  }
  try {
    await registerDevice(token);
  } catch (error) {
    warn('register_push_device failed', error);
  }
}

/** Asks iOS (the system dialog) and registers with APNs when granted. */
export async function enableNativePush(): Promise<'granted' | 'denied'> {
  const plugin = (await loadPushPlugin())?.plugin;
  if (!plugin) return 'denied';
  try {
    const { receive } = await plugin.requestPermissions();
    if (receive !== 'granted') return 'denied';
    await ensureRegistrationListeners(plugin);
    await plugin.register();
    return 'granted';
  } catch (error) {
    warn('enable failed', error);
    return 'denied';
  }
}

/**
 * On every launch and every user change. A token already in the Keychain moves to the
 * current user whatever the permission (otherwise the previous user of this phone keeps
 * receiving here); then, with permission, register() refreshes the token.
 */
export async function syncNativePush(): Promise<void> {
  const native = isNativeApp() ? getMesaasNative() : null;
  if (!native) return;
  try {
    const { value } = await native.keychainGet({ key: PUSH_TOKEN_KEY });
    if (value) await registerDevice(value);
  } catch (error) {
    warn('stored token sync failed', error);
  }

  const plugin = (await loadPushPlugin())?.plugin;
  if (!plugin) return;
  try {
    if ((await getPushPermission()) !== 'granted') return;
    await ensureRegistrationListeners(plugin);
    await plugin.register();
  } catch (error) {
    warn('register failed', error);
  }
}

/**
 * Logout: detach this device from the user while the session still exists. The Keychain
 * token is removed only when the RPC succeeded, so the next login can still move it.
 */
export async function unregisterNativePush(): Promise<void> {
  const native = isNativeApp() ? getMesaasNative() : null;
  if (!native) return;
  try {
    const { value } = await native.keychainGet({ key: PUSH_TOKEN_KEY });
    if (!value) return;
    const { error } = await supabase.rpc('unregister_push_device', { p_token: value });
    if (error) {
      warn('unregister_push_device failed', error);
      return;
    }
    await native.keychainRemove({ key: PUSH_TOKEN_KEY });
  } catch (error) {
    warn('unregister failed', error);
  }
}

// ---- Tap ---------------------------------------------------------------------------

function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // Control characters, space and the backslash browsers read as a slash.
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/** A CRM path the app shows: one leading `/`, not the landing, not a blocked page. */
function isTapDestination(link: string): boolean {
  if (!link.startsWith('/') || link.startsWith('//')) return false;
  if (hasUnsafeChar(link)) return false;
  // Also refuses `/` (the renderer's default for a missing link) and its query variants.
  return !isBlockedInNativeApp(link);
}

/**
 * A tap on a notification: mark it read (then refresh the bell) and open its link.
 * Summary pushes carry neither, so the app just opens where it was. Anything that is not
 * an in-app path is ignored (no open redirect).
 */
export function handlePushTap(data: PushTapData | null | undefined, deps: PushTapDeps): void {
  const id = data?.notification_id;
  if (typeof id === 'string' && id) {
    try {
      deps.markRead(id).then(
        () => {
          try {
            deps.refreshNotifications();
          } catch (error) {
            warn('refresh failed', error);
          }
        },
        (error: unknown) => warn('markRead failed', error),
      );
    } catch (error) {
      warn('markRead failed', error);
    }
  }

  const link = data?.link;
  if (typeof link === 'string' && isTapDestination(link)) {
    deps.navigate(link);
  }
}

// ---- Pre-prompt --------------------------------------------------------------------

export function shouldShowPrePrompt(
  permission: PushPermission,
  snoozedUntil: number | null,
  now: number,
): boolean {
  if (permission !== 'prompt') return false;
  return snoozedUntil === null || snoozedUntil <= now;
}

export function readPrePromptSnooze(): number | null {
  try {
    const raw = window.localStorage.getItem(PRE_PROMPT_SNOOZE_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** "Agora não": quiet for 7 days. */
export function snoozePrePrompt(now: number): void {
  try {
    window.localStorage.setItem(PRE_PROMPT_SNOOZE_KEY, String(now + PRE_PROMPT_SNOOZE_MS));
  } catch {
    // Storage blocked: the sheet may come back next launch, nothing worse.
  }
}
