/**
 * mention-email-cron: unread-mention digest email, one per user per run.
 *
 * Two layers, mirroring the repo's two existing cron shapes:
 *  - `createMentionEmailCronHandler` (notification-deadline-cron's shape): thin
 *    auth wrapper, checks `x-cron-secret` BEFORE any work and delegates to `run`.
 *  - `runMentionEmailCron` (lifecycle-email-cron's shape): dependency-injected
 *    business logic, testable without a network or a real database.
 *
 * Claim-first semantics (at-most-once), bounded two-step:
 *  1. SELECT the ids of eligible rows (the same five filters: type, read_at,
 *     dismissed_at, emailed_at, created_at window), ordered oldest-first and
 *     capped at `CLAIM_BATCH_SIZE` -- this bounds the sequential per-user send
 *     loop below so a large backlog of distinct recipients (or a slow Resend
 *     call) can't outlive the edge runtime's execution budget. Rows left over
 *     just wait for the next 5-minute run.
 *  2. `UPDATE ... WHERE id IN (ids) AND emailed_at IS NULL RETURNING ...`
 *     claims exactly those ids. Re-checking `emailed_at IS NULL` here (not just
 *     in step 1) is what keeps concurrent runs disjoint -- the step 1 snapshot
 *     is stale by the time step 2 executes, so without this re-check two
 *     overlapping invocations could both claim the same row.
 * Email is a courtesy copy of the bell notification (the reliable channel), so
 * a crash between claim and send loses that one email; a per-user SEND
 * failure gets a best-effort reset so the next run retries it.
 */

interface DbError {
  message: string;
}

export interface ClaimedNotification {
  id: number;
  user_id: string;
  metadata: Record<string, unknown> | null;
  link: string | null;
  created_at: string;
}

export interface EligibleNotificationId {
  id: number;
  created_at: string;
}

/** The read-only filter-builder chain used to find eligible ids before claiming them. */
export interface EligibleNotificationsFilterChain
  extends PromiseLike<{ data: EligibleNotificationId[] | null; error: DbError | null }> {
  eq(column: string, value: string): EligibleNotificationsFilterChain;
  is(column: string, value: null): EligibleNotificationsFilterChain;
  lte(column: string, value: string): EligibleNotificationsFilterChain;
  gte(column: string, value: string): EligibleNotificationsFilterChain;
  order(column: string, opts: { ascending: boolean }): EligibleNotificationsFilterChain;
  limit(n: number): EligibleNotificationsFilterChain;
}

/** The narrow slice of the PostgREST filter-builder chain the claim/reset UPDATE drives. */
export interface NotificationsFilterChain
  extends PromiseLike<{ data: ClaimedNotification[] | null; error: DbError | null }> {
  is(column: string, value: null): NotificationsFilterChain;
  in(column: string, values: number[]): NotificationsFilterChain;
  select(columns: string): NotificationsFilterChain;
}

export interface MentionEmailDb {
  from(table: "notifications"): {
    select(columns: string): EligibleNotificationsFilterChain;
    update(patch: { emailed_at: string | null }): NotificationsFilterChain;
  };
  auth: {
    admin: {
      getUserById(userId: string): Promise<{
        data: { user: { email?: string | null } | null } | null;
        error: DbError | null;
      }>;
    };
  };
}

export interface MentionEmailItem {
  actorName: string;
  contextTitle: string;
  excerpt?: string;
  link: string;
}

export interface MentionEmailCronDeps {
  db: MentionEmailDb;
  now: () => Date;
  /** Computed once in index.ts from `Deno.env.get("RESEND_API_KEY")` so this module stays env-free. */
  resendEnabled: boolean;
  sendMentionEmail: (
    p: { to: string; mentions: MentionEmailItem[] },
  ) => Promise<{ skipped: boolean }>;
  // `accountId` (not `userId`) to match `_shared/triage.ts`'s `CronFailureDetail`
  // shape, so `report` can be wired straight to `reportCronFailure`.
  report?: (
    detail: { failed: number; errors: Array<{ accountId?: string; error: string }> },
  ) => Promise<void>;
}

export interface MentionEmailCronResult {
  claimed: number;
  emailed: number;
  failed: number;
  skipped: boolean;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
// Caps how many rows a single run claims. The per-user send loop below is
// sequential (one Resend call per distinct recipient), so an unbounded claim
// could outlive the edge runtime's execution budget when a backlog spans many
// distinct users or a send is slow -- rows claimed-but-never-sent would lose
// their email permanently. Leftover eligible rows simply wait for the next
// 5-minute cron run.
const CLAIM_BATCH_SIZE = 200;

function metadataString(metadata: Record<string, unknown> | null, key: string): string | undefined {
  const v = metadata?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function runMentionEmailCron(
  deps: MentionEmailCronDeps,
): Promise<MentionEmailCronResult> {
  // RESEND_API_KEY absent (e.g. staging): skip WITHOUT claiming so the rows
  // stay eligible for a future run once the key is configured, instead of
  // being permanently marked emailed_at with no email ever sent.
  if (!deps.resendEnabled) {
    return { claimed: 0, emailed: 0, failed: 0, skipped: true };
  }

  const now = deps.now();
  const claimBeforeIso = new Date(now.getTime() - TEN_MINUTES_MS).toISOString();
  const claimAfterIso = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS).toISOString();

  // Step 1: find eligible ids without claiming them yet, oldest-first, capped.
  const { data: eligible, error: eligibleErr } = await deps.db
    .from("notifications")
    .select("id, created_at")
    .eq("type", "mention")
    .is("read_at", null)
    .is("dismissed_at", null)
    .is("emailed_at", null)
    .lte("created_at", claimBeforeIso)
    .gte("created_at", claimAfterIso)
    .order("created_at", { ascending: true })
    .limit(CLAIM_BATCH_SIZE);

  if (eligibleErr) {
    throw new Error(`mention eligibility query failed: ${eligibleErr.message}`);
  }

  const eligibleIds = (eligible ?? []).map((r) => r.id);
  if (eligibleIds.length === 0) {
    return { claimed: 0, emailed: 0, failed: 0, skipped: false };
  }

  // Step 2: claim exactly those ids. Re-checking emailed_at IS NULL here keeps
  // concurrent runs disjoint (see module doc comment).
  const { data, error } = await deps.db
    .from("notifications")
    .update({ emailed_at: now.toISOString() })
    .in("id", eligibleIds)
    .is("emailed_at", null)
    .select("id, user_id, metadata, link, created_at");

  if (error) throw new Error(`mention claim failed: ${error.message}`);

  const claimed = (data ?? []) as ClaimedNotification[];
  if (claimed.length === 0) {
    return { claimed: 0, emailed: 0, failed: 0, skipped: false };
  }

  const byUser = new Map<string, ClaimedNotification[]>();
  for (const row of claimed) {
    const list = byUser.get(row.user_id);
    if (list) list.push(row);
    else byUser.set(row.user_id, [row]);
  }

  let emailed = 0;
  let failed = 0;
  const errors: Array<{ accountId?: string; error: string }> = [];

  for (const [userId, rows] of byUser) {
    try {
      const { data: userData, error: userErr } = await deps.db.auth.admin.getUserById(userId);
      if (userErr) throw new Error(userErr.message);
      const email = userData?.user?.email;
      if (!email) throw new Error("user has no email on file");

      const mentions: MentionEmailItem[] = rows.map((r) => ({
        actorName: metadataString(r.metadata, "actor_name") ?? "Alguém",
        contextTitle: metadataString(r.metadata, "context_title") ?? "",
        excerpt: metadataString(r.metadata, "excerpt"),
        link: r.link ?? "/",
      }));

      await deps.sendMentionEmail({ to: email, mentions });
      emailed++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ accountId: userId, error: message });
      console.error(`[mention-email-cron] send failed for user=${userId}:`, message);

      // Best-effort: an ambiguous failure here means the next run just skips
      // this user again (still claimed) unless we release the claim.
      const ids = rows.map((r) => r.id);
      const { error: resetErr } = await deps.db
        .from("notifications")
        .update({ emailed_at: null })
        .in("id", ids);
      if (resetErr) {
        console.error(
          `[mention-email-cron] claim reset failed for user=${userId}:`,
          resetErr.message,
        );
      }
    }
  }

  if (errors.length > 0 && deps.report) {
    await deps.report({ failed: errors.length, errors });
  }

  return { claimed: claimed.length, emailed, failed, skipped: false };
}

// ─── Auth wrapper (notification-deadline-cron's shape) ──────────────────────

interface MentionEmailCronHandlerDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createMentionEmailCronHandler(deps: MentionEmailCronHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
