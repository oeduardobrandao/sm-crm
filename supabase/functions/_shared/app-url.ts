/**
 * Public base URL of the deployed apps. The CRM lives at `/`, the Hub at `/:workspace/hub/:token`
 * on the same origin (see vercel.json rewrites), so one base serves both.
 *
 * Deliberately NOT OAUTH_REDIRECT_BASE: that variable means "where Meta sends the OAuth callback"
 * and coupling the two would make an OAuth change silently rewrite customer email links.
 *
 * REQUIRED with no fallback: both callers (notifyOwnerOfFailure in stripe-webhook, resolveHubUrl)
 * are wrapped in try/catch and degrade safely on the throw, so a missing env becomes a logged
 * omission instead of a localhost link shipped to a paying customer.
 */
export function appBaseUrl(): string {
  const url = Deno.env.get("APP_BASE_URL");
  if (!url) throw new Error("APP_BASE_URL environment variable is required");
  return url;
}
