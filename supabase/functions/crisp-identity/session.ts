/**
 * Get-or-create the caller's Crisp Session Continuity token.
 *
 * Pure and dependency-injected, like sign.ts: crisp-identity_test.ts never
 * imports index.ts (it throws at module load without CRISP_IDENTITY_SECRET,
 * which the edge-function-tests CI job does not set), so the upsert has to be
 * testable through a fake `db` rather than through the handler.
 *
 * `db` is the same loose structural shape _shared/instagram-publish-utils.ts
 * and _shared/tiktok-publish-utils.ts use for an injected client. A narrower
 * structural type is a known deno-check trap: passing a real SupabaseClient
 * to it can fail with TS2589 (excessively deep instantiation).
 */
// deno-lint-ignore no-explicit-any
export type CrispSessionDb = { from: (table: string) => any };

/**
 * Returns the user's stable token, or null on ANY failure. Best-effort by
 * design: identity verification (the signature) is the more established of
 * crisp-identity's two jobs and must never become collateral damage of this
 * table -- the caller simply omits `crispToken` from the response on null.
 *
 * `.upsert({ user_id }, { onConflict: 'user_id' })` with `ignoreDuplicates`
 * left at its default (false) compiles to
 *   INSERT ... ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
 *   RETURNING token
 * which returns the EXISTING row's token on the conflicting call. Do NOT set
 * `ignoreDuplicates: true`: that is ON CONFLICT DO NOTHING, which returns no
 * row on conflict and would break "a second call returns the same token".
 */
export async function getOrCreateCrispToken(
  db: CrispSessionDb,
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("crisp_sessions")
      .upsert({ user_id: userId }, { onConflict: "user_id" })
      .select("token")
      .single();
    if (error) {
      console.error("[crisp-identity] crisp_sessions upsert failed", error.message ?? error);
      return null;
    }
    const token = (data as { token?: unknown } | null)?.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch (err) {
    console.error("[crisp-identity] crisp_sessions upsert threw", err);
    return null;
  }
}
