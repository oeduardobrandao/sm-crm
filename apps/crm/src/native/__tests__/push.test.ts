import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The shell's bridge (window.Capacitor) is stubbed for real, so platform.ts and
// mesaasNative.ts run unmocked; only the push plugin and the Supabase client are fakes.
const { plugin, rpc, events } = vi.hoisted(() => {
  const events: string[] = [];
  const methods = {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    register: vi.fn(async () => {
      events.push('register');
    }),
    addListener: vi.fn(async (name: string, _fn: (arg: unknown) => void) => {
      events.push(`listen:${name}`);
      return { remove: vi.fn(async () => {}) };
    }),
  };
  // Shaped like Capacitor's registerPlugin() proxy: ANY other property, including
  // `then`, is a native method call whose promise never settles here. Resolving an
  // async function with this object would hang, which is the bug this guards against.
  const plugin = new Proxy(methods, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      if (prop === '$$typeof') return undefined;
      return () => new Promise(() => {});
    },
  }) as typeof methods;
  return { plugin, rpc: vi.fn(), events };
});

vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));

import type * as PushModule from '../push';

type Keychain = Map<string, string>;

function makeNative(keychain: Keychain, env: 'sandbox' | 'production' = 'sandbox') {
  return {
    keychainGet: vi.fn(async ({ key }: { key: string }) => ({ value: keychain.get(key) ?? null })),
    keychainSet: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      keychain.set(key, value);
    }),
    keychainRemove: vi.fn(async ({ key }: { key: string }) => {
      keychain.delete(key);
    }),
    deviceInfo: vi.fn(async () => ({ pushEnvironment: env, appVersion: '1.2.0' })),
    openSettings: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
  };
}

function setBridge(native: ReturnType<typeof makeNative> | null) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: (name: string) =>
      name === 'PushNotifications' || (name === 'MesaasNative' && native !== null),
    Plugins: native ? { MesaasNative: native } : {},
  };
}

let push: typeof PushModule;
let keychain: Keychain;
let native: ReturnType<typeof makeNative>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  events.length = 0;
  keychain = new Map();
  native = makeNative(keychain);
  setBridge(native);
  rpc.mockResolvedValue({ data: null, error: null });
  plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
  plugin.requestPermissions.mockResolvedValue({ receive: 'granted' });
  push = await import('../push');
});

afterEach(() => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
  localStorage.clear();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function tapDeps() {
  return {
    navigate: vi.fn(),
    markRead: vi.fn(async () => {}),
    refreshNotifications: vi.fn(),
  };
}

describe('handlePushTap', () => {
  it('marks the notification read, refreshes the bell and opens the link', async () => {
    const deps = tapDeps();
    push.handlePushTap({ link: '/entregas?post=1', notification_id: 'n1' }, deps);
    await flush();
    expect(deps.markRead).toHaveBeenCalledWith('n1');
    expect(deps.refreshNotifications).toHaveBeenCalledTimes(1);
    expect(deps.navigate).toHaveBeenCalledWith('/entregas?post=1');
  });

  it('does nothing for a summary push (null link and id)', async () => {
    const deps = tapDeps();
    push.handlePushTap({ link: null, notification_id: null }, deps);
    await flush();
    expect(deps.markRead).not.toHaveBeenCalled();
    expect(deps.refreshNotifications).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it.each([
    '/',
    '/?x=1',
    '/precos',
    '/configuracao/cobranca',
    '//evil.com',
    '/\\evil.com',
    'https://evil.com',
    'javascript:x',
    'entregas',
    '',
  ])('never navigates to %j', async (link) => {
    const deps = tapDeps();
    push.handlePushTap({ link, notification_id: 'n1' }, deps);
    await flush();
    expect(deps.navigate).not.toHaveBeenCalled();
    // The notification is still marked read: it was opened.
    expect(deps.markRead).toHaveBeenCalledWith('n1');
  });

  it('ignores non-string payload values', async () => {
    const deps = tapDeps();
    push.handlePushTap({ link: 42, notification_id: { id: 'x' } }, deps);
    await flush();
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.markRead).not.toHaveBeenCalled();
  });

  it('swallows a markRead rejection', async () => {
    const deps = tapDeps();
    deps.markRead.mockRejectedValueOnce(new Error('offline'));
    expect(() =>
      push.handlePushTap({ link: '/entregas', notification_id: 'n1' }, deps),
    ).not.toThrow();
    await flush();
    expect(deps.navigate).toHaveBeenCalledWith('/entregas');
    expect(deps.refreshNotifications).not.toHaveBeenCalled();
  });
});

describe('shouldShowPrePrompt', () => {
  const now = 1_000_000;
  it('never shows once iOS answered', () => {
    expect(push.shouldShowPrePrompt('denied', null, now)).toBe(false);
    expect(push.shouldShowPrePrompt('granted', null, now)).toBe(false);
  });
  it('respects a snooze in the future', () => {
    expect(push.shouldShowPrePrompt('prompt', now + 1, now)).toBe(false);
  });
  it('shows with no snooze or an expired one', () => {
    expect(push.shouldShowPrePrompt('prompt', null, now)).toBe(true);
    expect(push.shouldShowPrePrompt('prompt', now - 1, now)).toBe(true);
  });
  it('snoozes for 7 days in localStorage', () => {
    push.snoozePrePrompt(now);
    expect(localStorage.getItem('mesaas.pushPrePrompt.snoozedUntil')).toBe(
      String(now + 7 * 24 * 60 * 60 * 1000),
    );
    expect(push.readPrePromptSnooze()).toBe(now + 7 * 24 * 60 * 60 * 1000);
  });
  it('reads a missing or garbage snooze as null', () => {
    expect(push.readPrePromptSnooze()).toBeNull();
    localStorage.setItem('mesaas.pushPrePrompt.snoozedUntil', 'abc');
    expect(push.readPrePromptSnooze()).toBeNull();
  });
});

describe('getPushPermission', () => {
  it('maps the plugin state', async () => {
    plugin.checkPermissions.mockResolvedValueOnce({ receive: 'granted' });
    expect(await push.getPushPermission()).toBe('granted');
    plugin.checkPermissions.mockResolvedValueOnce({ receive: 'prompt-with-rationale' });
    expect(await push.getPushPermission()).toBe('prompt');
    plugin.checkPermissions.mockResolvedValueOnce({ receive: 'denied' });
    expect(await push.getPushPermission()).toBe('denied');
  });
});

describe('onRegistration', () => {
  it('stores the token and registers it with the build environment', async () => {
    await push.onRegistration('tok-1');
    expect(keychain.get('mesaas.pushToken')).toBe('tok-1');
    expect(rpc).toHaveBeenCalledWith('register_push_device', {
      p_token: 'tok-1',
      p_platform: 'ios',
      p_environment: 'sandbox',
      p_app_version: '1.2.0',
    });
  });

  it('uses production when the build says so', async () => {
    setBridge(makeNative(keychain, 'production'));
    await push.onRegistration('tok-2');
    expect(rpc).toHaveBeenCalledWith(
      'register_push_device',
      expect.objectContaining({ p_environment: 'production' }),
    );
  });

  it('never rejects when the RPC fails', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(push.onRegistration('tok-3')).resolves.toBeUndefined();
  });
});

describe('unregisterNativePush', () => {
  it('unregisters and forgets the token', async () => {
    keychain.set('mesaas.pushToken', 'tok-1');
    await push.unregisterNativePush();
    expect(rpc).toHaveBeenCalledWith('unregister_push_device', { p_token: 'tok-1' });
    expect(keychain.has('mesaas.pushToken')).toBe(false);
  });

  it('resolves and keeps the token when the RPC rejects', async () => {
    keychain.set('mesaas.pushToken', 'tok-1');
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(push.unregisterNativePush()).resolves.toBeUndefined();
    expect(keychain.get('mesaas.pushToken')).toBe('tok-1');
  });

  it('keeps the token when the RPC returns an error', async () => {
    keychain.set('mesaas.pushToken', 'tok-1');
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await push.unregisterNativePush();
    expect(keychain.get('mesaas.pushToken')).toBe('tok-1');
  });

  it('does nothing without a stored token', async () => {
    await push.unregisterNativePush();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does nothing on an older binary without MesaasNative', async () => {
    setBridge(null);
    await expect(push.unregisterNativePush()).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('syncNativePush', () => {
  it('moves a stored token to the current user even without permission', async () => {
    keychain.set('mesaas.pushToken', 'tok-old');
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    await push.syncNativePush();
    expect(rpc).toHaveBeenCalledWith(
      'register_push_device',
      expect.objectContaining({ p_token: 'tok-old', p_platform: 'ios' }),
    );
    expect(plugin.register).not.toHaveBeenCalled();
  });

  it('moves a stored token even when permission is denied', async () => {
    keychain.set('mesaas.pushToken', 'tok-old');
    plugin.checkPermissions.mockResolvedValue({ receive: 'denied' });
    await push.syncNativePush();
    expect(rpc).toHaveBeenCalledWith(
      'register_push_device',
      expect.objectContaining({ p_token: 'tok-old' }),
    );
    expect(plugin.register).not.toHaveBeenCalled();
  });

  it('with permission, attaches the registration listener before register()', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    await push.syncNativePush();
    expect(plugin.register).toHaveBeenCalledTimes(1);
    const registerAt = events.indexOf('register');
    expect(events.indexOf('listen:registration')).toBeGreaterThan(-1);
    expect(events.indexOf('listen:registration')).toBeLessThan(registerAt);
  });

  it('the registration event stores and registers the new token', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    await push.syncNativePush();
    const call = plugin.addListener.mock.calls.find(([name]) => name === 'registration');
    call![1]({ value: 'tok-new' });
    await flush();
    expect(keychain.get('mesaas.pushToken')).toBe('tok-new');
    expect(rpc).toHaveBeenCalledWith(
      'register_push_device',
      expect.objectContaining({ p_token: 'tok-new' }),
    );
  });

  it('never rejects', async () => {
    keychain.set('mesaas.pushToken', 'tok-old');
    rpc.mockRejectedValue(new Error('offline'));
    plugin.checkPermissions.mockRejectedValue(new Error('bridge'));
    await expect(push.syncNativePush()).resolves.toBeUndefined();
  });

  it('is a no-op on the web', async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
    await push.syncNativePush();
    expect(rpc).not.toHaveBeenCalled();
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
  });
});

describe('enableNativePush', () => {
  it('requests permission and registers after the listener is attached', async () => {
    expect(await push.enableNativePush()).toBe('granted');
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(events.indexOf('listen:registration')).toBeLessThan(events.indexOf('register'));
  });

  it('does not register when the user says no', async () => {
    plugin.requestPermissions.mockResolvedValueOnce({ receive: 'denied' });
    expect(await push.enableNativePush()).toBe('denied');
    expect(plugin.register).not.toHaveBeenCalled();
  });
});

describe('attachNativePushListeners', () => {
  it('adds registration, error and tap listeners once and forwards the tap data', async () => {
    const onTap = vi.fn();
    const detach = await push.attachNativePushListeners(onTap);
    const names = plugin.addListener.mock.calls.map(([name]) => name).sort();
    expect(names).toEqual(['pushNotificationActionPerformed', 'registration', 'registrationError']);
    const tap = plugin.addListener.mock.calls.find(
      ([name]) => name === 'pushNotificationActionPerformed',
    );
    tap![1]({ actionId: 'tap', notification: { id: 'x', data: { link: '/entregas' } } });
    expect(onTap).toHaveBeenCalledWith({ link: '/entregas' });

    // A later register() reuses the same registration listener.
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    await push.syncNativePush();
    expect(plugin.addListener).toHaveBeenCalledTimes(3);

    await detach();
    const handles = await Promise.all(plugin.addListener.mock.results.map((r) => r.value));
    for (const h of handles) expect(h.remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the registration listener while another mount still holds it', async () => {
    const first = push.attachNativePushListeners(vi.fn());
    const second = push.attachNativePushListeners(vi.fn());
    await (
      await first
    )();
    const regHandle =
      await plugin.addListener.mock.results[
        plugin.addListener.mock.calls.findIndex(([name]) => name === 'registration')
      ].value;
    expect(regHandle.remove).not.toHaveBeenCalled();
    await (
      await second
    )();
    expect(regHandle.remove).toHaveBeenCalledTimes(1);
  });
});
