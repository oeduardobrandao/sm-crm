/**
 * notification-email-cron: agency-user notification digest email, one per
 * user per run.
 *
 * Two layers, mirroring the repo's existing cron shapes:
 *  - `createNotificationEmailCronHandler` (notification-deadline-cron's
 *    shape): thin auth wrapper, checks `x-cron-secret` BEFORE any work and
 *    delegates to `run`.
 *  - `runNotificationEmailCron` (lifecycle-email-cron's shape): dependency-
 *    injected business logic, testable without a network or a real database.
 *
 * Claim-first semantics (at-most-once claim / at-least-once delivery), via
 * ONE atomic `claim_notification_emails` RPC (Task 2's migration): the SQL
 * does the type/settle/age-window filter, the read/dismissed/emailed
 * re-check, the workspace-membership check, the opt-out check, and the
 * `FOR UPDATE SKIP LOCKED` claim in a single statement, capped at
 * `CLAIM_BATCH_SIZE`. That bounds the sequential per-user send loop below so
 * a large backlog of distinct recipients (or a slow Resend call) can't
 * outlive the edge runtime's execution budget; rows left over just wait for
 * the next run. Because the concurrency/opt-out/membership races are already
 * covered by the RPC (and the Task 2 entitlement test), this handler's tests
 * cover orchestration only: skip-without-claiming, one-send-per-user,
 * urgency ordering, per-user failure reset, deadline release,
 * unresolved-email failure, and the triage report.
 *
 * Email is a courtesy copy of the bell notification (the reliable channel),
 * so a crash between claim and send loses that one email; a per-user SEND
 * failure gets a best-effort reset (`emailed_at -> NULL`) so the next run
 * retries it.
 *
 * Even with CLAIM_BATCH_SIZE bounding claimed ROWS, the send loop is
 * sequential and keyed by DISTINCT recipient -- a backlog spanning many
 * distinct users, or a slow Resend/getUserById call, can still run long
 * enough to outlive the edge runtime mid-loop. Without a deadline, rows
 * already claimed for users the loop never reached would keep emailed_at set
 * forever (they're not a per-user SEND failure, so the failure-path reset
 * never runs), permanently losing that email beyond the single-crash case
 * this design otherwise accepts. SEND_DEADLINE_MS is a soft wall-clock
 * budget: the loop checks it before starting each user and, if exceeded,
 * releases every remaining unprocessed user's claim (emailed_at -> NULL) in
 * one best-effort UPDATE and stops, counting those rows as `released` so the
 * next run picks them back up.
 */
import {
  buildDigestIdempotencyKey,
  type DigestItem,
  resolveDigestItem,
} from "../_shared/notification-email.ts";

interface DbError { message: string }

export interface ClaimedNotificationRow {
  id: string;
  user_id: string;
  type: string;
  metadata: Record<string, unknown> | null;
  link: string | null;
  created_at: string;
}

export interface NotificationEmailDb {
  rpc(
    fn: "claim_notification_emails",
    args: { p_settle_before: string; p_after: string; p_limit: number },
  ): Promise<{ data: ClaimedNotificationRow[] | null; error: DbError | null }>;
  from(table: "notifications"): {
    update(patch: { emailed_at: null }): {
      in(column: "id", ids: string[]): PromiseLike<{ error: DbError | null }>;
    };
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

export interface NotificationEmailCronDeps {
  db: NotificationEmailDb;
  now: () => Date;
  nowMs?: () => number;
  resendEnabled: boolean;
  sendDigest: (p: { to: string; items: DigestItem[]; idempotencyKey: string }) => Promise<{ skipped: boolean }>;
  report?: (detail: { failed: number; errors: Array<{ accountId?: string; error: string }> }) => Promise<void>;
}

export interface NotificationEmailCronResult {
  claimed: number; emailed: number; failed: number; released: number; skipped: boolean;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const CLAIM_BATCH_SIZE = 100;
const SEND_DEADLINE_MS = 60_000;

async function releaseClaims(db: NotificationEmailDb, ids: string[]): Promise<void> {
  const { error } = await db.from("notifications").update({ emailed_at: null }).in("id", ids);
  if (error) console.error(`[notification-email-cron] release failed for ${ids.length} ids:`, error.message);
}

export async function runNotificationEmailCron(
  deps: NotificationEmailCronDeps,
): Promise<NotificationEmailCronResult> {
  if (!deps.resendEnabled) return { claimed: 0, emailed: 0, failed: 0, released: 0, skipped: true };

  const clockNow = deps.nowMs ?? Date.now;
  const startedAt = clockNow();
  const now = deps.now();
  const settleBefore = new Date(now.getTime() - TEN_MINUTES_MS).toISOString();
  const after = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS).toISOString();

  const { data, error } = await deps.db.rpc("claim_notification_emails", {
    p_settle_before: settleBefore, p_after: after, p_limit: CLAIM_BATCH_SIZE,
  });
  if (error) throw new Error(`claim_notification_emails failed: ${error.message}`);
  const rows = (data ?? []) as ClaimedNotificationRow[];
  if (rows.length === 0) return { claimed: 0, emailed: 0, failed: 0, released: 0, skipped: false };

  const byUser = new Map<string, ClaimedNotificationRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.user_id);
    if (list) list.push(row); else byUser.set(row.user_id, [row]);
  }
  const userEntries = Array.from(byUser.entries());

  let emailed = 0, failed = 0, released = 0;
  const errors: Array<{ accountId?: string; error: string }> = [];

  for (let i = 0; i < userEntries.length; i++) {
    if (clockNow() - startedAt > SEND_DEADLINE_MS) {
      const remainingIds = userEntries.slice(i).flatMap(([, rs]) => rs.map((r) => r.id));
      released += remainingIds.length;
      await releaseClaims(deps.db, remainingIds);
      break;
    }
    const [userId, userRows] = userEntries[i];
    try {
      const { data: userData, error: userErr } = await deps.db.auth.admin.getUserById(userId);
      if (userErr) throw new Error(userErr.message);
      const email = userData?.user?.email;
      if (!email) throw new Error("user has no email on file");

      const items = userRows.map((r) => resolveDigestItem(r)).sort((a, b) => a.priority - b.priority);
      const idempotencyKey = await buildDigestIdempotencyKey(userId, userRows.map((r) => r.id));
      await deps.sendDigest({ to: email, items, idempotencyKey });
      emailed++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ accountId: userId, error: message });
      console.error(`[notification-email-cron] send failed for user=${userId}:`, message);
      await releaseClaims(deps.db, userRows.map((r) => r.id));
    }
  }

  if (errors.length > 0 && deps.report) await deps.report({ failed: errors.length, errors });
  return { claimed: rows.length, emailed, failed, released, skipped: false };
}

// ─── Auth wrapper (mention-email-cron's shape) ──────────────────────────────
interface NotificationEmailCronHandlerDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createNotificationEmailCronHandler(deps: NotificationEmailCronHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
