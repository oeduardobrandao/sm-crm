/**
 * Support chat widget (Chatwoot). Replaces Crisp.
 *
 * Loaded from `main.tsx` rather than a `<script>` in index.html, mirroring `analytics.ts`: the
 * token comes from the environment instead of being hardcoded, and the whole module no-ops when
 * it is unset. Blank is the right value for local dev and CI -- it keeps test runs and localhost
 * clicks out of the real support inbox.
 *
 * THE READINESS BUFFER IS THE POINT OF THIS MODULE.
 *
 * Crisp's snippet set `window.$crisp = []` synchronously, so `.push([...])` before the script
 * loaded was buffered by the array itself and callers could fire and forget from anywhere.
 * Chatwoot has no such buffer: `window.$chatwoot` is undefined until the `chatwoot:ready` event
 * fires. AuthContext's identify effect routinely runs before that, so a direct port would drop
 * the identity silently and the inbox would show anonymous visitors. Everything below funnels
 * through `run()`, which applies immediately once ready and queues until then.
 */

const TOKEN = import.meta.env.VITE_CHATWOOT_TOKEN as string | undefined;
const BASE_URL =
  (import.meta.env.VITE_CHATWOOT_BASE_URL as string | undefined) ?? 'https://app.chatwoot.com';

export interface SupportChatUser {
  id: string;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
}

interface ChatwootSDK {
  toggle: (state?: 'open' | 'close') => void;
  toggleBubbleVisibility: (state: 'show' | 'hide') => void;
  setUser: (
    identifier: string,
    attributes: { email?: string; name?: string; phone_number?: string },
  ) => void;
  reset: () => void;
}

declare global {
  interface Window {
    $chatwoot?: ChatwootSDK;
    chatwootSDK?: { run: (options: { websiteToken: string; baseUrl: string }) => void };
    chatwootSettings?: Record<string, unknown>;
  }
}

const enabled = Boolean(TOKEN);

let ready = false;
let initialised = false;
let pending: Array<(sdk: ChatwootSDK) => void> = [];

/**
 * Identity is stored in a single slot rather than queued.
 *
 * Queueing would replay every intermediate value: a stale email after an email change, and --
 * worse -- the OUTGOING user's identity after `resetSupportChat()` on a shared machine. That is
 * precisely the cross-account bleed the reset calls in AuthContext exist to prevent, so a reset
 * clears this slot and the queue together.
 */
let latestIdentity: SupportChatUser | null = null;

/**
 * Every call is individually guarded. The comments this replaces were emphatic that a
 * support-tooling failure must never break an auth transition or sign-out, and sign-out is a
 * security-relevant path -- so the try/catch lives here, once, instead of at four call sites.
 */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // Never let a support-tooling nicety break the caller.
  }
}

function run(fn: (sdk: ChatwootSDK) => void): void {
  if (!enabled) return;
  const sdk = window.$chatwoot;
  if (ready && sdk) {
    safely(() => fn(sdk));
    return;
  }
  pending.push(fn);
}

function applyIdentity(sdk: ChatwootSDK): void {
  if (!latestIdentity) return;
  const { id, email, name, phone } = latestIdentity;
  safely(() =>
    sdk.setUser(id, {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(phone ? { phone_number: phone } : {}),
    }),
  );
}

/** Injects the widget. Call once, from `main.tsx`, alongside `initAnalytics()`. */
export function initSupportChat(): void {
  if (!enabled || initialised || typeof window === 'undefined') return;
  initialised = true;

  window.chatwootSettings = { locale: 'pt_BR', position: 'right', type: 'standard' };

  window.addEventListener('chatwoot:ready', () => {
    const sdk = window.$chatwoot;
    if (!sdk) return;
    ready = true;
    // Identity first: a queued open() should act on an already-identified session.
    applyIdentity(sdk);
    const queued = pending;
    pending = [];
    queued.forEach((fn) => safely(() => fn(sdk)));
  });

  const script = document.createElement('script');
  script.src = `${BASE_URL}/packs/js/sdk.js`;
  script.async = true;
  script.onload = () => {
    safely(() => window.chatwootSDK?.run({ websiteToken: TOKEN as string, baseUrl: BASE_URL }));
  };
  document.head.appendChild(script);
}

/** Opens the widget, un-hiding the bubble first (the app shell keeps it hidden by default). */
export function openSupportChat(): void {
  run((sdk) => {
    sdk.toggleBubbleVisibility('show');
    sdk.toggle('open');
  });
}

export function showSupportChatBubble(): void {
  run((sdk) => sdk.toggleBubbleVisibility('show'));
}

export function hideSupportChatBubble(): void {
  run((sdk) => sdk.toggleBubbleVisibility('hide'));
}

export function identifySupportUser(user: SupportChatUser): void {
  if (!enabled) return;
  latestIdentity = user;
  const sdk = window.$chatwoot;
  if (ready && sdk) applyIdentity(sdk);
}

/**
 * Clears the identified contact. Called on sign-out and on a user switch so the next person on a
 * shared browser does not inherit the previous one's support contact.
 */
export function resetSupportChat(): void {
  if (!enabled) return;
  latestIdentity = null;
  pending = [];
  const sdk = window.$chatwoot;
  if (ready && sdk) safely(() => sdk.reset());
}

export type SupportChatEvent =
  | 'chatwoot:ready'
  | 'chatwoot:opened'
  | 'chatwoot:closed'
  | 'chatwoot:on-message';

/**
 * Subscribes to a widget event. Returns an unsubscribe -- unlike the Crisp version, which leaked
 * a listener on every remount. `window.addEventListener` makes that leak real (duplicate unread
 * updates), so callers must return this from their effect.
 */
export function onSupportChatEvent(
  event: SupportChatEvent,
  handler: (detail: unknown) => void,
): () => void {
  if (!enabled || typeof window === 'undefined') return () => {};
  const listener = (e: Event) => handler((e as CustomEvent).detail);
  window.addEventListener(event, listener);
  return () => window.removeEventListener(event, listener);
}

/**
 * Whether a `chatwoot:on-message` payload should light the unread dot.
 *
 * The event fires for both directions, so the user's own send would otherwise mark itself unread.
 * Chatwoot types messages 0 = incoming (from the contact) and 1 = outgoing (from an agent), but
 * the payload shape has varied across versions -- so this excludes only what it can positively
 * identify as the contact's own message and defaults to true otherwise, matching Crisp's
 * `message:received` semantics (a missed dot is worse than a spurious one).
 */
export function isUnreadMessage(detail: unknown): boolean {
  if (!detail || typeof detail !== 'object') return true;
  const type = (detail as { message_type?: unknown }).message_type;
  return !(type === 0 || type === 'incoming');
}
