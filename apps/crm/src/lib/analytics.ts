import posthog from 'posthog-js';

/**
 * Product analytics. EU cloud region.
 *
 * A closed union rather than free-form strings: an event name typo produces a silently missing
 * funnel step, which is worse than a build error because nobody notices for weeks.
 */
export type AnalyticsEvent =
  | 'signup_completed'
  | 'workspace_setup_completed'
  | 'client_created'
  | 'instagram_connected'
  | 'workflow_created'
  | 'hub_link_copied'
  | 'report_generated'
  | 'invite_sent';

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
  });
  enabled = true;
}

export function identifyWorkspaceUser(userId: string, props: WorkspaceUserProps): void {
  if (!enabled) return;
  posthog.identify(userId, { ...props });
  // Retention is a property of the workspace, not the individual — an agency churns, not a seat.
  posthog.group('workspace', props.workspace_id);
}

export function captureEvent(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!enabled) return;
  posthog.capture(event, props);
}

export function resetAnalytics(): void {
  if (!enabled) return;
  posthog.reset();
}
