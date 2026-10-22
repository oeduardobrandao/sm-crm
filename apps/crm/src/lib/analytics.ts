// Type-only: the SDK itself is loaded on demand by initAnalytics (see loadSdk below).
import type { PostHog } from 'posthog-js';

/**
 * Product analytics. EU cloud region.
 *
 * A closed union rather than free-form strings: an event name typo produces a silently missing
 * funnel step, which is worse than a build error because nobody notices for weeks.
 */
export type AnalyticsEvent =
  | 'signup_completed'
  // Desktop Vidro opt-out/opt-in from the account menu (src/hooks/useVidro.ts).
  | 'vidro_look_toggled'
  // Vidro launch intro (src/components/layout/VidroIntro.tsx); its "back to classic" button
  // fires vidro_look_toggled through useVidro.
  | 'vidro_intro_shown'
  | 'vidro_intro_dismissed'
  | 'client_created'
  // Two distinct steps, deliberately not collapsed: `_started` fires when the user leaves for
  // Meta's consent screen, `instagram_connected` is the activation milestone and may only be
  // fired once the callback confirms a live connection. Nothing fires it yet — the OAuth success
  // leg redirects to /clientes/:id with no marker to key off (instagram-integration/index.ts).
  | 'instagram_connect_started'
  | 'instagram_connected'
  // TikTok activation milestone: fired once by RedesSociaisTab when the OAuth callback lands with tt_connected=1.
  | 'tiktok_connected'
  | 'workflow_created'
  | 'workflow_wizard_source'
  | 'workflow_saved_as_template'
  | 'entregas_tour_started'
  | 'entregas_tour_completed'
  | 'entregas_tour_dismissed'
  // The always-reachable "Como funciona" panel. Tracked separately from the tour so
  // its reach can be compared against it — the tour only auto-starts on an empty
  // board, which is why so few accounts ever saw it.
  | 'entregas_explainer_shown'
  | 'entregas_explainer_reopened'
  | 'entregas_explainer_dismissed'
  // Lista de Entregas: uma por troca do "Agrupar por" (com a dimensão escolhida) e
  // uma por abertura do painel Responsáveis. Ambas levam `mode` (entregas | publicacoes).
  | 'entregas_lista_agrupar'
  | 'entregas_lista_responsaveis_aberto'
  // "Minha fila": one per entry into the fila tab (and again on member switch),
  // the dashboard teaser's clicks (item row vs "Ver minha fila"), and each change
  // of the fila's section order (prazo da etapa vs data de publicação).
  | 'minha_fila_opened'
  | 'minha_fila_ordem_changed'
  | 'minha_fila_teaser_clicked'
  | 'guide_opened'
  | 'guide_closed'
  | 'guide_page_viewed'
  | 'guide_action_clicked'
  | 'guide_trail_completed'
  | 'guide_completed'
  | 'guide_video_played'
  | 'popup_shown'
  | 'popup_page'
  | 'popup_closed'
  | 'popup_cta'
  | 'popup_ack'
  | 'hub_link_copied'
  | 'hub_upgrade_prompt_clicked'
  | 'report_generated'
  | 'invite_sent'
  | 'contract_created'
  | 'lead_created'
  | 'lead_converted'
  | 'task_created'
  | 'checkout_started'
  | 'trial_step_viewed'
  | 'trial_skipped'
  | 'trial_nudge_clicked'
  | 'whatsapp_support_clicked'
  | 'card_form_submitted'
  | 'card_tokenization_failed'
  | 'checkout_completed'
  | 'checkout_failed'
  | 'card_form_abandoned';

/**
 * Compile-time guard: `tsc` fails if any of these names is dropped from or misspelled in the union
 * above. It lives here rather than in the test file because `apps/crm/tsconfig.json` excludes the
 * `__tests__` directory, so a guard placed there would never be type-checked by `npm run build`.
 * Vitest transpiles via esbuild without type-checking, so no runtime test can enforce this either.
 */
const _wizardAndTourEvents: AnalyticsEvent[] = [
  'workflow_wizard_source',
  'workflow_saved_as_template',
  'entregas_tour_started',
  'entregas_tour_completed',
  'entregas_tour_dismissed',
];

export interface WorkspaceUserProps {
  workspace_id: string;
  plan_id: string | null;
  role: string;
}

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com';

// Two flags, not one: `initialized` = a posthog.init has run (never resets, so a re-grant can
// never double-init); `capturing` = our helpers may send. Consent revoke flips only `capturing`.
// `capturing` goes true the moment initAnalytics runs, even while the SDK is still downloading.
let initialized = false;
let capturing = false;
// Last workspace identity AuthContext reported, kept in memory only (never sent while not
// capturing) so a later start can identify the person. Cleared by resetAnalytics.
let lastIdentity: { userId: string; props: WorkspaceUserProps } | null = null;

// posthog-js is ~220 KB minified. A static import put it in the CRM entry bundle, which the
// landing page downloads before first paint, for an SDK that only starts after cookie consent
// (and never without a key). So it is a dynamic import, fetched the first time initAnalytics runs.
let sdk: PostHog | null = null;
let loading: Promise<void> | null = null;
// Calls made while capturing but before the SDK arrived, replayed in order right after init.
// Bounded so a stalled download cannot grow it without limit; overflow drops the newest calls
// (the head holds the identity replay, which matters more than one extra event). Dropped on
// revoke and on a failed download.
type PendingCall = (ph: PostHog) => void;
const MAX_PENDING = 100;
let pending: PendingCall[] = [];

function run(call: PendingCall): void {
  if (sdk) {
    call(sdk);
    return;
  }
  if (pending.length < MAX_PENDING) pending.push(call);
}

function applyIdentity(ph: PostHog, userId: string, props: WorkspaceUserProps): void {
  ph.identify(userId, { ...props });
  // Retention is a property of the workspace, not the individual — an agency churns, not a seat.
  ph.group('workspace', props.workspace_id);
}

function startSdk(ph: PostHog): void {
  if (!KEY) return;
  if (!initialized) {
    ph.init(KEY, {
      api_host: HOST,
      // Do not build a person profile for anonymous landing-page traffic — it is noise here, and
      // fewer profiles is the easier LGPD posture to defend.
      person_profiles: 'identified_only',
      capture_pageview: true,
      // Unhandled errors and rejections land in PostHog error tracking. Without this a production
      // JS error is invisible unless a user reports it, and a click that dies on an exception is
      // indistinguishable from a dead button in the rageclick data.
      capture_exceptions: true,
      // Opting out must also drop the ph_* identifier from storage. Without this, opt-out stops
      // capture but leaves distinct_id/device_id behind.
      opt_out_persistence_by_default: true,
      // reset() (run on revoke) ends with reloadFeatureFlags(), a /flags POST scheduled 5ms out
      // that carries the pre-revoke $device_id and is NOT gated on opt-out. The CRM uses no
      // feature flags, so skip that reload. Deliberately NOT `advanced_disable_flags`: that one
      // also stops remote config from loading, which is what starts session replay and heatmaps.
      advanced_disable_feature_flags: true,
    });
    initialized = true;
  }
  // The SDK's opt-out flag survives page loads: a user who revoked yesterday and accepts today
  // gets an initialised but still opted-out SDK unless we opt back in. `captureEventName: false`
  // suppresses the default `$opt_in` event.
  if (ph.has_opted_out_capturing()) ph.opt_in_capturing({ captureEventName: false });
}

function loadSdk(): void {
  if (loading) return;
  loading = import('posthog-js').then(
    (mod) => {
      loading = null;
      sdk = mod.default;
      const queued = pending;
      pending = [];
      // Revoked while downloading: the SDK must not be initialised at all. A later grant takes
      // the synchronous path in initAnalytics.
      if (!capturing) return;
      startSdk(sdk);
      for (const call of queued) call(sdk);
    },
    () => {
      // Network failure (offline, flaky mobile). Swallowed: analytics must never surface as an
      // unhandled rejection. Back to "not started" so the next initAnalytics retries the import.
      loading = null;
      pending = [];
      capturing = false;
    },
  );
}

/**
 * Start or resume product analytics. Called by consent handling only after the visitor opted in
 * (lib/consentEffects.ts). Safe to call when unconfigured (local dev, CI, self-hosters): no-ops,
 * and posthog-js is never downloaded. Idempotent: the first call loads the SDK and runs
 * posthog.init, later calls (after a revoke) only opt back in.
 */
export function initAnalytics(): void {
  if (!KEY) return;
  if (sdk) {
    startSdk(sdk);
    capturing = true;
    if (lastIdentity) applyIdentity(sdk, lastIdentity.userId, lastIdentity.props);
    return;
  }
  // Already started and still downloading: nothing new to queue.
  if (capturing) return;
  capturing = true;
  // The identity replay is queued first so it lands before anything captured in the meantime,
  // exactly where the synchronous path runs it.
  if (lastIdentity) {
    const { userId, props } = lastIdentity;
    run((ph) => applyIdentity(ph, userId, props));
  }
  loadSdk();
}

/**
 * Stop capturing (consent revoked). ORDER MATTERS: reset() deletes the SDK's opt-out flag, so it
 * must run before opt_out_capturing(); the reverse order silently un-revokes and the SDK's own
 * emitters ($pageview, exception capture, autocapture, session replay) resume.
 * Revoked before the SDK finished downloading: drop the queue; the load handler then skips init.
 */
export function disableAnalytics(): void {
  if (!capturing) return;
  capturing = false;
  if (!sdk || !initialized) {
    pending = [];
    return;
  }
  sdk.reset();
  sdk.opt_out_capturing();
}

/**
 * Stitch signup to a real person. Under `person_profiles: 'identified_only'`, events captured
 * while anonymous are personless and are NEVER retroactively attached to the person created by a
 * later identify — so `signup_completed` fired before this call leaves every signup as an orphan
 * whose history ends at the form, and the signup→activation funnel cannot be measured. Must run
 * before the `signup_completed` capture. Only the Supabase uuid goes out (no email/name), which
 * keeps the fewer-profiles LGPD posture that motivated `identified_only`. Without analytics
 * consent nothing is sent and the signup is simply not attributed.
 */
export function identifySignup(userId: string): void {
  if (!capturing) return;
  run((ph) => ph.identify(userId));
}

export function identifyWorkspaceUser(userId: string, props: WorkspaceUserProps): void {
  lastIdentity = { userId, props };
  if (!capturing) return;
  run((ph) => applyIdentity(ph, userId, props));
}

export interface CaptureOptions {
  /**
   * Bypass posthog-js request batching. `capture()` normally only enqueues, and the queue is
   * flushed on an interval or by the pagehide handler. That handler usually saves an event
   * captured immediately before a redirect, but "usually" is not a guarantee worth racing —
   * set this at any call site that navigates away in the same tick.
   */
  sendInstantly?: boolean;
}

export function captureEvent(
  event: AnalyticsEvent,
  props?: Record<string, unknown>,
  opts?: CaptureOptions,
): void {
  if (!capturing) return;
  if (opts?.sendInstantly) {
    run((ph) => ph.capture(event, props, { send_instantly: true }));
    return;
  }
  run((ph) => ph.capture(event, props));
}

export function resetAnalytics(): void {
  lastIdentity = null;
  if (!capturing) return;
  run((ph) => ph.reset());
}
