/**
 * Public base URL of the deployed apps. The CRM lives at `/`, the Hub at `/:workspace/hub/:token`
 * on the same origin (see vercel.json rewrites), so one base serves both.
 *
 * Deliberately NOT OAUTH_REDIRECT_BASE: that variable means "where Meta sends the OAuth callback"
 * and coupling the two would make an OAuth change silently rewrite customer email links.
 */
export function appBaseUrl(): string {
  return Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173";
}
