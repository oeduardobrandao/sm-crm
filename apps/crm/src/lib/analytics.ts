import posthog from 'posthog-js';

/**
 * Product analytics. EU cloud region.
 *
 * A closed union rather than free-form strings: an event name typo produces a silently missing
 * funnel step, which is worse than a build error because nobody notices for weeks.
 */
export type AnalyticsEvent =
  | 'signup_completed'
  | 'client_created'
  // Two distinct steps, deliberately not collapsed: `_started` fires when the user leaves for
  // Meta's consent screen, `instagram_connected` is the activation milestone and may only be
  // fired once the callback confirms a live connection. Nothing fires it yet — the OAuth success
  // leg redirects to /clientes/:id with no marker to key off (instagram-integration/index.ts).
  | 'instagram_connect_started'
  | 'instagram_connected'
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
  | 'guide_opened'
  | 'guide_closed'
  | 'guide_page_viewed'
  | 'guide_action_clicked'
  | 'guide_trail_completed'
  | 'guide_completed'
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

let enabled = false;

/** Safe to call when unconfigured (local dev, CI, self-hosters): every export then no-ops. */
export function initAnalytics(): void {
  if (!KEY || enabled) return;
  posthog.init(KEY, {
    api_host: HOST,
    // Do not build a person profile for anonymous landing-page traffic — it is noise here, and
    // fewer profiles is the easier LGPD posture to defend.
    person_profiles: 'identified_only',
    capture_pageview: true,
    // Unhandled errors and rejections land in PostHog error tracking. Without this a production
    // JS error is invisible unless a user reports it, and a click that dies on an exception is
    // indistinguishable from a dead button in the rageclick data.
    capture_exceptions: true,
  });
  enabled = true;
}

/**
 * Stitch signup to a real person. Under `person_profiles: 'identified_only'`, events captured
 * while anonymous are personless and are NEVER retroactively attached to the person created by a
 * later identify — so `signup_completed` fired before this call leaves every signup as an orphan
 * whose history ends at the form, and the signup→activation funnel cannot be measured. Must run
 * before the `signup_completed` capture. Only the Supabase uuid goes out (no email/name), which
 * keeps the fewer-profiles LGPD posture that motivated `identified_only`.
 */
export function identifySignup(userId: string): void {
  if (!enabled) return;
  posthog.identify(userId);
}

export function identifyWorkspaceUser(userId: string, props: WorkspaceUserProps): void {
  if (!enabled) return;
  posthog.identify(userId, { ...props });
  // Retention is a property of the workspace, not the individual — an agency churns, not a seat.
  posthog.group('workspace', props.workspace_id);
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
  if (!enabled) return;
  if (opts?.sendInstantly) {
    posthog.capture(event, props, { send_instantly: true });
    return;
  }
  posthog.capture(event, props);
}

export function resetAnalytics(): void {
  if (!enabled) return;
  posthog.reset();
}
