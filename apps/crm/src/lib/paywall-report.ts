import { supabase } from './supabase';

/**
 * Records that a free workspace was denied a gated feature, feeding the
 * `paywall_hit` marketing trigger.
 *
 * Fire-and-forget on purpose: this is a marketing signal, never worth delaying
 * or failing a user action. Every failure path is swallowed.
 *
 * FeatureGate renders on every page view, so renders are deduped per
 * (workspace, feature) per session. An upgrade CLICK is always sent: it is a
 * strictly higher-intent signal and must not be swallowed by the render dedupe.
 */
const reported = new Set<string>();

/** Test-only: clears the per-session dedupe set. */
export function __resetPaywallReportDedupe(): void {
  reported.clear();
}

export function reportPaywallHit(p: {
  workspaceId: string;
  feature: string;
  clickedUpgrade?: boolean;
}): void {
  const clicked = p.clickedUpgrade === true;
  const key = `${p.workspaceId}:${p.feature}`;
  if (!clicked) {
    if (reported.has(key)) return;
    reported.add(key);
  }

  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paywall-report`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: p.workspaceId,
          feature: p.feature,
          clicked_upgrade: clicked,
        }),
      });
    } catch {
      // Marketing signal only. Never surface to the user.
    }
  })();
}
