/**
 * Server-side PostHog capture. Measurement only — nothing in a delivery path
 * reads PostHog, and a failure here must never fail the thing being measured,
 * so callers swallow the throw.
 *
 * POSTHOG_PROJECT_KEY is the PROJECT WRITE key (the same value as the frontend's
 * VITE_POSTHOG_KEY), not a personal API key. Unset is a silent no-op so staging
 * and local runs work without it.
 */
const HOST = Deno.env.get("POSTHOG_HOST") ?? "https://eu.i.posthog.com";

export async function capturePostHog(
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const key = Deno.env.get("POSTHOG_PROJECT_KEY");
  if (!key) return;
  const res = await fetch(`${HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: distinctId,
      properties,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`PostHog capture failed: ${res.status}`);
}
