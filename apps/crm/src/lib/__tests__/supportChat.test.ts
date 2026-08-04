import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The readiness buffer is the reason `lib/supportChat.ts` exists, so it is what this suite covers.
 *
 * Crisp's snippet installed `window.$crisp = []` synchronously, so any `.push()` before the script
 * loaded was buffered by the array itself. Chatwoot has no equivalent: `window.$chatwoot` is
 * undefined until `chatwoot:ready` fires, and AuthContext's identify effect routinely runs first.
 * A direct port would drop the identity silently -- the inbox would just show anonymous visitors,
 * with nothing failing loudly enough to notice.
 *
 * The module reads its token at import time and holds `ready`/`pending` in module scope, so every
 * test re-imports it through `vi.resetModules()` with the env stubbed for that case.
 */

interface FakeSdk {
  toggle: ReturnType<typeof vi.fn>;
  toggleBubbleVisibility: ReturnType<typeof vi.fn>;
  setUser: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
}

function makeSdk(): FakeSdk {
  return {
    toggle: vi.fn(),
    toggleBubbleVisibility: vi.fn(),
    setUser: vi.fn(),
    reset: vi.fn(),
  };
}

/** Mimics the SDK boot: the object appears on `window`, then the event fires. */
function fireReady(sdk: FakeSdk): void {
  (window as unknown as { $chatwoot: FakeSdk }).$chatwoot = sdk;
  window.dispatchEvent(new CustomEvent('chatwoot:ready'));
}

/**
 * `window` is shared across tests in a file, but `vi.resetModules()` hands each test its OWN
 * module instance -- and `initSupportChat()` registers a `chatwoot:ready` listener that closes
 * over that instance's state. Without tracking them, a later `fireReady()` also wakes every
 * earlier instance's listener, and their stale `latestIdentity` calls `setUser` on the current
 * test's fake SDK. That is an artefact of re-importing, not a production path: the real app
 * imports the module once and `initSupportChat()` guards itself against a second call.
 */
const trackedListeners: Array<[string, EventListenerOrEventListenerObject]> = [];

async function loadModule(token: string | undefined) {
  vi.resetModules();
  vi.stubEnv('VITE_CHATWOOT_TOKEN', token ?? '');
  return import('../supportChat');
}

beforeEach(() => {
  const original = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type.startsWith('chatwoot:')) trackedListeners.push([type, listener]);
    original(type, listener, options);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  trackedListeners.forEach(([type, listener]) => window.removeEventListener(type, listener));
  trackedListeners.length = 0;
  vi.unstubAllEnvs();
  delete (window as { $chatwoot?: unknown }).$chatwoot;
  delete (window as { chatwootSettings?: unknown }).chatwootSettings;
});

describe('supportChat readiness buffer', () => {
  let mod: Awaited<ReturnType<typeof loadModule>>;

  beforeEach(async () => {
    mod = await loadModule('test-token');
    mod.initSupportChat();
  });

  it('applies commands issued before chatwoot:ready once the widget boots', () => {
    const sdk = makeSdk();

    // Before ready: nothing can have been called, because the SDK does not exist yet.
    mod.openSupportChat();
    expect(sdk.toggle).not.toHaveBeenCalled();

    fireReady(sdk);

    expect(sdk.toggleBubbleVisibility).toHaveBeenCalledWith('show');
    expect(sdk.toggle).toHaveBeenCalledWith('open');
  });

  it('applies identity issued before ready, and only the latest value', () => {
    // The identity is a single slot rather than a queue precisely so an email change before boot
    // does not replay the stale address after it.
    mod.identifySupportUser({ id: 'user-1', email: 'old@example.com', name: 'Eduardo' });
    mod.identifySupportUser({ id: 'user-1', email: 'new@example.com', name: 'Eduardo' });

    const sdk = makeSdk();
    fireReady(sdk);

    expect(sdk.setUser).toHaveBeenCalledTimes(1);
    expect(sdk.setUser).toHaveBeenCalledWith('user-1', {
      email: 'new@example.com',
      name: 'Eduardo',
    });
  });

  it('drops a pending identity when reset happens before ready', () => {
    // The shared-machine case: user A is identified, signs out, and user B boots the widget.
    // Replaying A's queued identity here would land B's support messages on A's contact -- the
    // exact bleed the reset calls in AuthContext exist to close.
    mod.identifySupportUser({ id: 'user-a', email: 'a@example.com' });
    mod.resetSupportChat();

    const sdk = makeSdk();
    fireReady(sdk);

    expect(sdk.setUser).not.toHaveBeenCalled();
  });

  it('applies identity immediately once ready', () => {
    const sdk = makeSdk();
    fireReady(sdk);

    mod.identifySupportUser({ id: 'user-1', email: 'e@example.com' });

    expect(sdk.setUser).toHaveBeenCalledWith('user-1', { email: 'e@example.com' });
  });

  it('passes phone through as phone_number and omits absent fields', () => {
    const sdk = makeSdk();
    fireReady(sdk);

    mod.identifySupportUser({ id: 'user-1', name: 'Eduardo', phone: '+5571988887777' });

    expect(sdk.setUser).toHaveBeenCalledWith('user-1', {
      name: 'Eduardo',
      phone_number: '+5571988887777',
    });
  });

  it('survives an SDK method that throws', () => {
    const sdk = makeSdk();
    sdk.reset.mockImplementation(() => {
      throw new Error('widget exploded');
    });
    fireReady(sdk);

    // resetSupportChat() runs inside signOut(), a security-relevant path: a widget failure must
    // never propagate into it.
    expect(() => mod.resetSupportChat()).not.toThrow();
  });

  it('unsubscribes event handlers so remounts do not stack listeners', () => {
    const handler = vi.fn();
    const off = mod.onSupportChatEvent('chatwoot:opened', handler);

    window.dispatchEvent(new CustomEvent('chatwoot:opened'));
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    window.dispatchEvent(new CustomEvent('chatwoot:opened'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('supportChat without a token', () => {
  it('no-ops entirely, injecting no script and touching no globals', async () => {
    const mod = await loadModule(undefined);
    const appendChild = vi.spyOn(document.head, 'appendChild');

    mod.initSupportChat();
    mod.openSupportChat();
    mod.identifySupportUser({ id: 'user-1', email: 'e@example.com' });
    mod.hideSupportChatBubble();
    mod.resetSupportChat();

    expect(appendChild).not.toHaveBeenCalled();
    expect(window.chatwootSettings).toBeUndefined();
    // A no-op subscribe still returns a callable unsubscribe, so callers need no special case.
    expect(() => mod.onSupportChatEvent('chatwoot:opened', vi.fn())()).not.toThrow();

    appendChild.mockRestore();
  });
});

describe('isUnreadMessage', () => {
  // `chatwoot:on-message` fires in both directions, so the user's own send would otherwise mark
  // itself unread. Anything not positively identifiable as the contact's own message counts as
  // unread -- a missed dot is worse than a spurious one, matching Crisp's `message:received`.
  it.each([
    ['an agent reply (numeric)', { message_type: 1 }, true],
    ['an agent reply (string)', { message_type: 'outgoing' }, true],
    ["the contact's own send (numeric)", { message_type: 0 }, false],
    ["the contact's own send (string)", { message_type: 'incoming' }, false],
    ['an unknown payload shape', { foo: 'bar' }, true],
    ['no payload at all', undefined, true],
  ])('treats %s as unread=%s', async (_label, detail, expected) => {
    const mod = await loadModule('test-token');
    expect(mod.isUnreadMessage(detail)).toBe(expected);
  });
});
