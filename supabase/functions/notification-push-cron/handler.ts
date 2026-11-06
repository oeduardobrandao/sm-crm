/**
 * notification-push-cron: push notifications to the Mesaas iOS app, every minute.
 *
 * Same two layers as notification-email-cron:
 *  - `createNotificationPushCronHandler`: checks `x-cron-secret` before any work.
 *  - `runNotificationPushCron`: dependency-injected logic, testable without a
 *    network or a database.
 *
 * Claim-first, at-most-once. `claim_notification_pushes` decides and stamps
 * `pushed_at` in one statement (type allowlist, unread, membership, opt-out,
 * active device, 15-minute window, SKIP LOCKED). A push is a courtesy copy of
 * the bell notification, so a failed send is logged and NOT retried: a retry a
 * minute later is worth less than the risk of a duplicate buzz. The one
 * exception is the soft deadline: users the loop never reached get their
 * claim released so the next run picks them up (still inside the window).
 *
 * One push per user per run: a single claimed row is pushed as itself; two or
 * more become one summary, so a burst of client activity buzzes once.
 */
import type { ApnsEnvironment, ApnsMessage, ApnsResult } from "../_shared/apns.ts";
import { type RenderedNotification, renderNotification } from "../_shared/notification-render.ts";

interface DbError { message: string }
type Result<T> = PromiseLike<{ data: T | null; error: DbError | null }>;

export interface ClaimedPushRow {
  id: string;
  user_id: string;
  workspace_id: string;
  type: string;
  metadata: Record<string, unknown> | null;
  link: string | null;
  created_at: string;
}

export interface PushDeviceRow {
  user_id: string;
  token: string;
  environment: ApnsEnvironment;
}

export interface NotificationPushDb {
  rpc(fn: "claim_notification_pushes", args: { p_after: string; p_limit: number }): Result<ClaimedPushRow[]>;
  rpc(fn: "push_badge_counts", args: { p_user_ids: string[] }): Result<Array<{ user_id: string; unread: number }>>;
  from(table: "push_devices"): {
    select(columns: "user_id, token, environment"): {
      in(column: "user_id", ids: string[]): {
        eq(column: "platform", value: "ios"): {
          is(column: "disabled_at", value: null): Result<PushDeviceRow[]>;
        };
      };
    };
    update(patch: { disabled_at: string }): {
      in(column: "token", tokens: string[]): PromiseLike<{ error: DbError | null }>;
    };
  };
  from(table: "notifications"): {
    update(patch: { pushed_at: null }): {
      in(column: "id", ids: string[]): PromiseLike<{ error: DbError | null }>;
    };
  };
}

export interface NotificationPushCronDeps {
  db: NotificationPushDb;
  /** Null when the APNs secrets are missing: the run is a no-op (dark deploy). */
  send: ((token: string, environment: ApnsEnvironment, message: ApnsMessage) => Promise<ApnsResult>) | null;
  now: () => Date;
  nowMs?: () => number;
  report?: (detail: { failed: number; errors: Array<{ accountId?: string; error: string }> }) => Promise<void>;
}

export interface NotificationPushCronResult {
  claimed: number;
  users: number;
  sent: number;
  failed: number;
  disabled: number;
  released: number;
  skipped: boolean;
}

const WINDOW_MS = 15 * 60 * 1000;
const CLAIM_BATCH_SIZE = 200;
const SEND_DEADLINE_MS = 40_000;
const BODY_MAX = 180;

const clamp = (t: string | undefined) =>
  t && t.length > BODY_MAX ? `${t.slice(0, BODY_MAX).trimEnd()}…` : t;

/** What one user's push says. Exported for tests. */
export function buildPushMessage(rows: ClaimedPushRow[], badge: number | undefined): ApnsMessage {
  const items: Array<RenderedNotification & { id: string }> = rows
    .map((r) => ({ ...renderNotification(r), id: r.id }))
    .sort((a, b) => a.priority - b.priority);

  if (items.length === 1) {
    const it = items[0];
    return {
      alert: { title: it.heading, subtitle: it.context, body: clamp(it.body) },
      badge,
      threadId: rows[0].type,
      data: { link: it.link, notification_id: it.id },
    };
  }

  const titles = items.slice(0, 3).map((i) => i.heading);
  const rest = items.length - titles.length;
  return {
    alert: {
      title: `${items.length} novas notificações no Mesaas`,
      body: clamp(rest > 0 ? `${titles.join(", ")} e mais ${rest}.` : `${titles.join(", ")}.`),
    },
    badge,
    threadId: "summary",
    // No single link fits a summary; the app opens where it was.
    data: { link: null, notification_id: null },
  };
}

async function releaseClaims(db: NotificationPushDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db.from("notifications").update({ pushed_at: null }).in("id", ids);
  if (error) console.error(`[notification-push-cron] release failed for ${ids.length} ids:`, error.message);
}

export async function runNotificationPushCron(deps: NotificationPushCronDeps): Promise<NotificationPushCronResult> {
  const empty = { claimed: 0, users: 0, sent: 0, failed: 0, disabled: 0, released: 0 };
  if (!deps.send) return { ...empty, skipped: true };
  const send = deps.send;

  const clockNow = deps.nowMs ?? Date.now;
  const startedAt = clockNow();
  const after = new Date(deps.now().getTime() - WINDOW_MS).toISOString();

  const { data, error } = await deps.db.rpc("claim_notification_pushes", { p_after: after, p_limit: CLAIM_BATCH_SIZE });
  if (error) throw new Error(`claim_notification_pushes failed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return { ...empty, skipped: false };

  const byUser = new Map<string, ClaimedPushRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.user_id);
    if (list) list.push(row);
    else byUser.set(row.user_id, [row]);
  }
  const userIds = Array.from(byUser.keys());

  const { data: devices, error: devErr } = await deps.db
    .from("push_devices")
    .select("user_id, token, environment")
    .in("user_id", userIds)
    .eq("platform", "ios")
    .is("disabled_at", null);
  if (devErr) {
    await releaseClaims(deps.db, rows.map((r) => r.id));
    throw new Error(`push_devices read failed: ${devErr.message}`);
  }
  const devicesByUser = new Map<string, PushDeviceRow[]>();
  for (const d of devices ?? []) {
    const list = devicesByUser.get(d.user_id);
    if (list) list.push(d);
    else devicesByUser.set(d.user_id, [d]);
  }

  // The badge is a nicety: without counts the push still goes out, minus badge.
  const badges = new Map<string, number>();
  const { data: counts, error: countErr } = await deps.db.rpc("push_badge_counts", { p_user_ids: userIds });
  if (countErr) console.error("[notification-push-cron] badge counts failed:", countErr.message);
  for (const c of counts ?? []) badges.set(c.user_id, c.unread);

  let sent = 0, failed = 0, released = 0;
  const deadTokens: string[] = [];
  const errors: Array<{ accountId?: string; error: string }> = [];
  const entries = Array.from(byUser.entries());

  for (let i = 0; i < entries.length; i++) {
    if (clockNow() - startedAt > SEND_DEADLINE_MS) {
      const remaining = entries.slice(i).flatMap(([, rs]) => rs.map((r) => r.id));
      released += remaining.length;
      await releaseClaims(deps.db, remaining);
      break;
    }
    const [userId, userRows] = entries[i];
    const userDevices = devicesByUser.get(userId) ?? [];
    if (userDevices.length === 0) continue; // device disabled between claim and read
    const message = buildPushMessage(userRows, badges.get(userId));

    const results = await Promise.allSettled(userDevices.map((d) => send(d.token, d.environment, message)));
    results.forEach((r, idx) => {
      let detail: string;
      if (r.status === "rejected") {
        detail = r.reason instanceof Error ? r.reason.message : String(r.reason);
      } else {
        const res = r.value;
        if (res.ok) {
          sent++;
          return;
        }
        if (res.unregistered) {
          deadTokens.push(userDevices[idx].token);
          return;
        }
        detail = `${res.status} ${res.reason}`;
      }
      failed++;
      errors.push({ accountId: userId, error: detail });
      console.error(`[notification-push-cron] send failed for user=${userId}:`, detail);
    });
  }

  if (deadTokens.length > 0) {
    const { error: disErr } = await deps.db
      .from("push_devices")
      .update({ disabled_at: deps.now().toISOString() })
      .in("token", deadTokens);
    if (disErr) console.error("[notification-push-cron] disabling dead tokens failed:", disErr.message);
  }

  if (errors.length > 0 && deps.report) await deps.report({ failed: errors.length, errors });
  return {
    claimed: rows.length,
    users: entries.length,
    sent,
    failed,
    disabled: deadTokens.length,
    released,
    skipped: false,
  };
}

interface NotificationPushCronHandlerDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createNotificationPushCronHandler(deps: NotificationPushCronHandlerDeps) {
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
