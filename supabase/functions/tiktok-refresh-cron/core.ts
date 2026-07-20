// tiktok-refresh-cron business logic — separated from index.ts (env wiring) and handler.ts
// (auth gate) so it's testable with the shared supabaseMock, per tiktok-token-refresh_test.ts's
// convention and instagram-sync-cron's fix for the retention initiative's cron-failure lesson:
// `svc` is a required dependency the CALLER creates and hoists (index.ts does this before the
// outer try), so the outer catch below can always reach it and call reportCronFailure — a cron
// that dies before that hoist happens is the silent-failure trap this file is built to avoid.
//
// Design (docs/superpowers/specs/2026-07-17-tiktok-integration-design.md, "tiktok-refresh-cron"):
// selects `active` accounts with access_token_expires_at <= now()+12h and runs the ONE shared
// refresh path (getFreshTikTokToken from _shared/tiktok.ts) per account — this file must never
// duplicate any of that helper's rotation/claim-lock/expiry-marking logic. Refreshing rotates the
// refresh-token VALUE but does not extend its 365-day expiry clock, so accounts whose
// refresh_token_expires_at falls within 30 days get a log line only (the connect UI and
// ScheduleButton read that column directly — no status column to flip here). Successfully
// refreshed accounts also get their avatar re-cached (best-effort, never affects the run's
// success/failure accounting).

import type { CronFailureDetail } from "../_shared/notify.ts";
import type { ThumbnailStorage } from "../_shared/tiktok-thumbnail-cache.ts";

// deno-lint-ignore no-explicit-any
type DbClient = any;

const ACCESS_TOKEN_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours
const REFRESH_TOKEN_WARNING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface TikTokRefreshCronDeps {
  /** Created and hoisted by the caller (index.ts) BEFORE the outer try, so a failure here
   * (e.g. the account query itself throwing) can still reach reportCronFailure below. */
  svc: DbClient;
  /** The ONLY code path allowed to read/refresh TikTok tokens — see _shared/tiktok.ts. */
  getFreshTikTokToken: (svc: DbClient, accountId: string) => Promise<{ accessToken: string; openId: string }>;
  reportCronFailure: (svc: DbClient, cronName: string, detail: CronFailureDetail) => Promise<void>;
  /** Re-caches a freshly-fetched TikTok avatar_url into the shared `avatars` bucket
   * (tiktok-integration/import.ts's cacheTikTokAvatar). Optional so tests that don't care about
   * avatar re-caching can omit it; index.ts always wires the real helper. */
  cacheAvatar?: (
    fetchImpl: typeof fetch,
    storage: ThumbnailStorage,
    accountKey: string | number,
    avatarUrl: string | null,
  ) => Promise<string | undefined>;
  /** Authenticated TikTok API fetch wrapper (_shared/tiktok.ts's tiktokFetch), used to look up
   * the account's current (short-lived, raw) avatar_url before re-caching it. */
  tiktokFetch?: (path: string, init: RequestInit & { accessToken: string }) => Promise<unknown>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface RefreshCandidateRow {
  id: string;
  client_id: string | number;
  avatar_url: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
}

const CRON_NAME = "tiktok-refresh-cron";

/** Extracts a readable message from an Error, a PostgrestError-shaped object (supabase-js
 * `throw error` on a failed select surfaces `{ message, code, ... }`, not an Error instance),
 * or anything else. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "unknown";
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Best-effort avatar re-cache for a just-refreshed account. Never throws — any failure is
 * logged and otherwise ignored, matching instagram-refresh-cron's non-fatal avatar handling. */
async function recacheAvatar(
  deps: TikTokRefreshCronDeps,
  account: RefreshCandidateRow,
  accessToken: string,
): Promise<void> {
  if (!deps.cacheAvatar || !deps.tiktokFetch) return;
  try {
    const profile = (await deps.tiktokFetch("/user/info/?fields=avatar_url", {
      method: "GET",
      accessToken,
    })) as { user?: { avatar_url?: string | null } };

    const cachedUrl = await deps.cacheAvatar(
      deps.fetchImpl ?? fetch,
      deps.svc.storage,
      account.client_id,
      profile?.user?.avatar_url ?? null,
    );
    if (!cachedUrl) return;

    const { error } = await deps.svc
      .from("tiktok_accounts")
      .update({ avatar_url: cachedUrl })
      .eq("id", account.id);
    if (error) {
      console.error(`[${CRON_NAME}] avatar_url persist failed for account ${account.id}:`, error.message);
    }
  } catch (e) {
    console.error(`[${CRON_NAME}] avatar re-cache failed for account ${account.id}:`, e instanceof Error ? e.message : e);
  }
}

export async function runTikTokRefreshCron(deps: TikTokRefreshCronDeps): Promise<Response> {
  const { svc, getFreshTikTokToken, reportCronFailure } = deps;

  try {
    const now = deps.now?.() ?? new Date();
    const accessWindowIso = new Date(now.getTime() + ACCESS_TOKEN_WINDOW_MS).toISOString();
    const refreshWarningIso = new Date(now.getTime() + REFRESH_TOKEN_WARNING_WINDOW_MS).toISOString();

    const { data: accounts, error } = await svc
      .from("tiktok_accounts")
      .select("id, client_id, avatar_url, access_token_expires_at, refresh_token_expires_at")
      .eq("authorization_status", "active")
      .lte("access_token_expires_at", accessWindowIso);

    if (error) throw error;

    const rows = (accounts ?? []) as RefreshCandidateRow[];
    if (rows.length === 0) {
      return json({ success: true, refreshed: 0, failed: 0 }, 200);
    }

    let refreshedCount = 0;
    let failedCount = 0;
    const errors: Array<{ accountId: string; error: string }> = [];

    for (const account of rows) {
      try {
        const { accessToken } = await getFreshTikTokToken(svc, account.id);
        refreshedCount++;

        if (account.refresh_token_expires_at && account.refresh_token_expires_at <= refreshWarningIso) {
          // No status column to flip — the connect UI and ScheduleButton read
          // refresh_token_expires_at directly. This log line is the only signal here.
          console.warn(
            `[${CRON_NAME}] account ${account.id} refresh_token_expires_at (${account.refresh_token_expires_at}) is within 30 days — reconnect required soon`,
          );
        }

        await recacheAvatar(deps, account, accessToken);
      } catch (err) {
        // getFreshTikTokToken already performs any account-status mutation it needs
        // (e.g. authorization_status='expired' on a dead refresh token) — this catch must
        // NOT duplicate that write. Just record the failure and move on to the next account.
        failedCount++;
        const message = errorMessage(err);
        errors.push({ accountId: account.id, error: message });
        console.error(`[${CRON_NAME}] account ${account.id} failed:`, message);
      }
    }

    if (failedCount > 0) {
      await reportCronFailure(svc, CRON_NAME, { total: rows.length, failed: failedCount, errors });
    }

    return json({ success: true, refreshed: refreshedCount, failed: failedCount }, 200);
  } catch (err) {
    const message = errorMessage(err);
    console.error(`[${CRON_NAME}] failed:`, message);
    await reportCronFailure(svc, CRON_NAME, {
      stack: err instanceof Error ? err.stack ?? message : message,
    });
    return json({ error: "Internal server error" }, 500);
  }
}
