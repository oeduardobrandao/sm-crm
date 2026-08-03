// supabase/functions/_shared/internal-workspaces.ts
//
// Workspaces flagged `is_internal` hold seeded/demo data whose credentials are
// placeholders, so every cron pass over them fails identically and files a
// cron_failures row plus an alert e-mail. The account-level crons
// (instagram-sync, instagram-refresh, tiktok-sync, tiktok-refresh) filter their
// candidates through this set.
//
// FAILS OPEN on purpose: a lookup error returns an empty set, so nothing is
// excluded and the run proceeds as it did before the flag existed. The failure
// mode of a closed default is skipping paying customers because one small query
// hiccuped, which is strictly worse than one wasted sync of a test account.

// deno-lint-ignore no-explicit-any
type DbClient = any;

export async function fetchInternalWorkspaceIds(svc: DbClient): Promise<Set<string>> {
  try {
    const { data, error } = await svc
      .from("workspaces")
      .select("id")
      .eq("is_internal", true);

    if (error) {
      console.error(`[internal-workspaces] lookup failed, excluding none: ${error.message}`);
      return new Set<string>();
    }

    return new Set<string>(((data ?? []) as Array<{ id: string }>).map((w) => w.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[internal-workspaces] lookup threw, excluding none: ${message}`);
    return new Set<string>();
  }
}
