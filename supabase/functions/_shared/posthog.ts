/**
 * Server-side PostHog capture. Measurement only — nothing in a delivery path
 * reads PostHog, and a failure here must never fail the thing being measured,
 * so callers swallow the throw.
 *
 * POSTHOG_PROJECT_KEY is the PROJECT WRITE key (the same value as the frontend's
 * VITE_POSTHOG_KEY), not a personal API key. Unset is a silent no-op so staging
 * and local runs work without it.
 *
 * Group association travels inside `properties.$groups` (e.g.
 * `{ workspace: workspaceId }`), the HTTP-capture-API equivalent of the
 * frontend's `posthog.group('workspace', ...)` — no dedicated param needed,
 * `properties` is an open bag.
 *
 * Both env vars are read lazily (inside the function), not at module scope,
 * so tests can set them after import — same pattern as `_shared/notify.ts`.
 */
export async function capturePostHog(
  event: string,
  distinctId: string,
  properties: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const key = Deno.env.get("POSTHOG_PROJECT_KEY");
  if (!key) return;
  const host = Deno.env.get("POSTHOG_HOST") ?? "https://eu.i.posthog.com";
  const res = await fetchImpl(`${host}/capture/`, {
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
