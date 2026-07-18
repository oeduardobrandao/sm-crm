// supabase/functions/tiktok-webhook/handler.ts
//
// TikTok Phase B, Task B6: durable webhook receiver. Registered in the TikTok developer portal
// (design doc "tiktok-webhook"). At-least-once delivery, 72h retries -> handlers must be
// idempotent AND the request path must never ACK (200) a delivery it then loses.
//
// Durable-ack pattern (never ACK-then-lose):
//   1. Validate synchronously: client_key must match TIKTOK_CLIENT_KEY, and user_openid must
//      resolve to a known tiktok_accounts row. Either failure -> 200, DROP, no insert (TikTok
//      has no way to fix a bad client_key/unknown account by retrying, so there's nothing to
//      gain from a 4xx/5xx here — and a 200 stops the 72h retry storm for real).
//   2. INSERT the raw event into tiktok_webhook_events SYNCHRONOUSLY, awaited BEFORE the
//      response is built. If the insert itself fails, respond 500 so TikTok's 72h retry
//      redelivers — losing the raw event would mean losing the only durable record TikTok ever
//      sent us this notification.
//   3. Respond 200 (empty body — see below).
//   4. ONLY THEN kick off processing via the injected `waitUntil` (the repo's established
//      fire-and-forget seam, wired to EdgeRuntime.waitUntil in index.ts exactly like
//      instagram-publish/index.ts:22-23). Processing re-confirms every webhook payload against
//      TikTok's own status-fetch API before mutating anything — the payload is a HINT, never
//      trusted directly (design doc) — and stamps `processed_at` on completion. A crash during
//      processing leaves `processed_at` NULL; sweeping/reconciling those rows is NOT this
//      handler's job (tiktok-publish-cron's status phase independently converges state anyway,
//      and a Task C4 sweep is expected to purge old rows).
//
// NEVER echo payload data back in the response — every response here is a bare status with no
// body (200/500), matching the security rule against returning raw internal data to callers.
//
// This is a PUBLIC endpoint (config.toml: verify_jwt = false) — no JWT, no cron secret. The
// client_key check + unknown-user_openid drop above ARE the auth.

import {
  confirmAndApplyPublishStatus as realConfirmAndApplyPublishStatus,
  errorMessage,
  type ConfirmAndApplyPublishStatusOutcome,
} from "../_shared/tiktok-publish-utils.ts";
import {
  getFreshTikTokToken as realGetFreshTikTokToken,
  tiktokFetch as realTiktokFetch,
} from "../_shared/tiktok.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import {
  EVENT_AUTH_REMOVED,
  EVENT_NO_LONGER_PUBLICALY_AVAILABLE, // sic — TikTok's own misspelling, never "fixed" here
  EVENT_PUBLICLY_AVAILABLE,
  EVENT_PUBLISH_COMPLETE,
  EVENT_PUBLISH_FAILED,
} from "../_shared/tiktok.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

interface TikTokWebhookPayload {
  client_key?: string;
  event?: string;
  create_time?: number;
  user_openid?: string;
  content?: string;
}

/** `content` is TikTok's own JSON-serialized sub-payload (design doc: "content is SERIALIZED
 * JSON — parse it; for post events it carries publish_id (and post_id for publicly_available
 * events)"). Fields here are a superset across the four post.publish.* events we handle;
 * every field is optional and unused fields are simply undefined per event type. */
interface TikTokWebhookContent {
  publish_id?: string;
  post_id?: string;
  reason?: string;
  publish_type?: string;
}

interface TikTokAccountRow {
  id: string;
  username: string | null;
  client_id: number;
  authorization_status: string;
}

interface FoundPost {
  post_id: number;
  tiktok_publish_id: string | null;
  tiktok_publish_retry_count: number;
}

export interface TikTokWebhookDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createServiceDb: () => DbClient;
  /** The expected client_key, read from TIKTOK_CLIENT_KEY by index.ts and injected here so
   * this module never reads Deno.env itself (same shape as tiktok-publish-cron's cronSecret). */
  tiktokClientKey: string;
  /** The repo's established fire-and-forget seam (EdgeRuntime.waitUntil in index.ts) — injected
   * so tests can await the processing promise directly instead of racing a background task. */
  waitUntil: (promise: Promise<void>) => void;
  getFreshTikTokToken?: typeof realGetFreshTikTokToken;
  tiktokFetch?: typeof realTiktokFetch;
  confirmAndApplyPublishStatus?: typeof realConfirmAndApplyPublishStatus;
  /** Generates the tiktok_webhook_events row id client-side (same DI pattern as
   * design-import/design-manage/generate-image's `randomUUID` seam) — avoids an
   * insert().select().single() round trip just to learn the id we need for the later
   * processed_at update. */
  randomUUID?: () => string;
  now?: () => Date;
}

function parseContent(raw: string | undefined): TikTokWebhookContent {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as TikTokWebhookContent) : {};
  } catch {
    return {};
  }
}

async function findPostByPublishId(svc: DbClient, publishId: string | undefined): Promise<FoundPost | null> {
  if (!publishId) return null;
  const { data, error } = await svc
    .from("workflow_posts")
    .select("id, tiktok_publish_id, tiktok_publish_retry_count")
    .eq("tiktok_publish_id", publishId)
    .maybeSingle();
  if (error) {
    throw new Error(`tiktok-webhook: workflow_posts lookup by publish_id failed: ${error.message}`);
  }
  if (!data) return null;
  return {
    post_id: data.id,
    tiktok_publish_id: data.tiktok_publish_id,
    tiktok_publish_retry_count: data.tiktok_publish_retry_count,
  };
}

/** Resolves conta_id for the audit log via the account's client_id -> clientes join — best
 * effort only (matches insertAuditLog's own "must never break the primary operation" contract):
 * a lookup failure logs and proceeds with an unattributed (but still recorded) audit row rather
 * than blocking the account revocation itself. */
async function resolveContaId(svc: DbClient, clientId: number): Promise<string | undefined> {
  const { data, error } = await svc.from("clientes").select("conta_id").eq("id", clientId).maybeSingle();
  if (error) {
    console.error("[tiktok-webhook] failed to resolve conta_id for audit log:", error.message);
    return undefined;
  }
  return (data?.conta_id as string | undefined) ?? undefined;
}

interface ProcessCtx {
  svc: DbClient;
  getFreshToken: typeof realGetFreshTikTokToken;
  tiktokFetchFn: typeof realTiktokFetch;
  confirmAndApply: typeof realConfirmAndApplyPublishStatus;
  now: () => Date;
}

interface ProcessArgs {
  eventRowId: string;
  eventName: string;
  account: TikTokAccountRow;
  contentRaw: string | undefined;
}

/** Claims the SAME `tiktok_publish_processing_at` lock claim_posts_for_tiktok_publishing uses
 * (migration 20260719000001_tiktok_publishing.sql: NULL or older than the 10-minute stale
 * window) so a webhook-triggered re-confirmation and a concurrently running cron status-fetch
 * can never both act on the same post. Returns the claimed post id, or `null` if the cron
 * currently holds the lock (not an error — the caller treats that as "cron owns this one"). */
async function claimPublishLock(
  svc: DbClient,
  postId: number,
  now: () => Date,
): Promise<{ claimed: boolean }> {
  const staleBefore = new Date(now().getTime() - 10 * 60_000).toISOString();
  const { data, error } = await svc
    .from("workflow_posts")
    .update({ tiktok_publish_processing_at: now().toISOString() })
    .eq("id", postId)
    .or(`tiktok_publish_processing_at.is.null,tiktok_publish_processing_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`tiktok-webhook: failed to claim publish lock for post ${postId}: ${error.message}`);
  }
  return { claimed: !!data };
}

/** post.publish.complete/failed: the webhook is a HINT — always re-confirm via the shared
 * status-resolution step (also used by tiktok-publish-cron's status phase) rather than trusting
 * the event's own `reason`/`publish_type` fields.
 *
 * Race with the cron (design doc follow-up): without coordination, a cron status-fetch that
 * started against the PRIOR TikTok state just before this webhook arrived could commit AFTER
 * this webhook applies the fresher outcome — e.g. re-writing `tiktok_publish_status='processing'`
 * right after this handler committed 'published'. Self-heals on the cron's next run, but it's a
 * routine occurrence, not a rare one (the webhook and the per-minute cron are both normal, active
 * paths to the same row). Fixed by claiming the exact same `tiktok_publish_processing_at` lock
 * the cron's claim RPC uses (claimPublishLock above) before calling confirmAndApplyPublishStatus:
 * whichever side wins the claim is the one that gets to resolve this post for this pass; if the
 * cron already holds it, the cron's own status-fetch converges to the same truth, so ceding to it
 * is a safe no-op, not a missed update.
 *
 * Never throws on the "normal" paths (confirmAndApplyPublishStatus's own contract): a post that
 * can't be found by publish_id, or a lock currently held by the cron, is logged and treated as a
 * no-op. A DB error while claiming the lock DOES throw (same as findPostByPublishId's own
 * DB-error path) — that leaves the event's `processed_at` NULL so it stays a candidate for
 * redelivery/sweep rather than being silently marked processed. */
async function handlePublishCompleteOrFailed(
  ctx: ProcessCtx,
  args: ProcessArgs,
  content: TikTokWebhookContent,
): Promise<void> {
  const post = await findPostByPublishId(ctx.svc, content.publish_id);
  if (!post) {
    console.log(
      `[tiktok-webhook] ${args.eventName}: no post found for publish_id ${content.publish_id ?? "(missing)"}`,
    );
    return;
  }

  const { claimed } = await claimPublishLock(ctx.svc, post.post_id, ctx.now);
  if (!claimed) {
    console.log(
      `[tiktok-webhook] ${args.eventName}: post ${post.post_id} publish lock held by tiktok-publish-cron — ` +
        `ceding resolution to the cron's own status-fetch`,
    );
    return;
  }

  const { accessToken } = await ctx.getFreshToken(ctx.svc as never, args.account.id);
  const outcome: ConfirmAndApplyPublishStatusOutcome = await ctx.confirmAndApply(
    { svc: ctx.svc, tiktokFetch: ctx.tiktokFetchFn, accessToken, now: ctx.now },
    {
      post_id: post.post_id,
      tiktok_publish_id: post.tiktok_publish_id,
      tiktok_publish_retry_count: post.tiktok_publish_retry_count,
      tiktok_username: args.account.username,
    },
  );
  console.log(`[tiktok-webhook] ${args.eventName}: post ${post.post_id} re-confirmed as ${outcome}`);
  // NOTE: no explicit lock release here. confirmAndApplyPublishStatus's own module comment
  // (_shared/tiktok-publish-utils.ts) documents that every outcome branch clears
  // tiktok_publish_processing_at as part of its write: "published" via mark_platform_published
  // (whose SQL unconditionally clears the column), "processing" via its own explicit update, and
  // "failed" via markTikTokPublishFailed's update — so the claim taken above is released on
  // every branch by the time this function returns.
}

/** post.publish.publicly_available: stores tiktok_post_id + tiktok_post_url via a direct,
 * error-checked update (NOT via mark_platform_published — the post was already published by an
 * earlier post.publish.complete/status-fetch confirmation; this only adds the public URL once
 * TikTok's own review makes it visible). Idempotent by construction: re-delivery writes the
 * exact same values, and the update is unconditional (no read-then-branch), so there is no
 * lost-update window between two deliveries. */
async function handlePubliclyAvailable(
  ctx: ProcessCtx,
  args: ProcessArgs,
  content: TikTokWebhookContent,
): Promise<void> {
  const post = await findPostByPublishId(ctx.svc, content.publish_id);
  if (!post || !content.post_id) {
    console.log(
      `[tiktok-webhook] publicly_available: missing post/post_id (publish_id ${content.publish_id ?? "(missing)"})`,
    );
    return;
  }

  const fields: Record<string, unknown> = { tiktok_post_id: content.post_id };
  if (args.account.username) {
    fields.tiktok_post_url = `https://www.tiktok.com/@${args.account.username}/video/${content.post_id}`;
  }

  const { error } = await ctx.svc.from("workflow_posts").update(fields).eq("id", post.post_id);
  if (error) {
    throw new Error(`tiktok-webhook: failed to store tiktok_post_id/url for post ${post.post_id}: ${error.message}`);
  }
  console.log(`[tiktok-webhook] publicly_available: post ${post.post_id} -> ${content.post_id}`);
}

/** post.publish.no_longer_publicaly_available (sic): clears tiktok_post_url only, KEEPING
 * tiktok_post_id — the post still exists on TikTok, it's just no longer publicly viewable
 * (e.g. flipped to private). Idempotent: re-delivery clears an already-null column. */
async function handleNoLongerPubliclyAvailable(
  ctx: ProcessCtx,
  args: ProcessArgs,
  content: TikTokWebhookContent,
): Promise<void> {
  const post = await findPostByPublishId(ctx.svc, content.publish_id);
  if (!post) {
    console.log(
      `[tiktok-webhook] no_longer_publicaly_available: no post found for publish_id ${content.publish_id ?? "(missing)"}`,
    );
    return;
  }

  const { error } = await ctx.svc.from("workflow_posts").update({ tiktok_post_url: null }).eq("id", post.post_id);
  if (error) {
    throw new Error(`tiktok-webhook: failed to clear tiktok_post_url for post ${post.post_id}: ${error.message}`);
  }
  console.log(`[tiktok-webhook] post ${post.post_id} is no longer publicly available.`);
}

/** authorization.removed: revokes the account (error-checked — a failure here throws, so the
 * event is NOT marked processed and stays a candidate for reconciliation) then best-effort
 * audit-logs it (insertAuditLog never throws — see its own module comment). */
async function handleAuthRemoved(ctx: ProcessCtx, args: ProcessArgs): Promise<void> {
  const { error } = await ctx.svc
    .from("tiktok_accounts")
    .update({ authorization_status: "revoked" })
    .eq("id", args.account.id);
  if (error) {
    throw new Error(`tiktok-webhook: failed to revoke tiktok_accounts ${args.account.id}: ${error.message}`);
  }

  const contaId = await resolveContaId(ctx.svc, args.account.client_id);
  await insertAuditLog(ctx.svc, {
    conta_id: contaId,
    action: "tiktok-auth-removed",
    resource_type: "tiktok_account",
    resource_id: String(args.account.id),
  });
}

async function routeEvent(ctx: ProcessCtx, args: ProcessArgs): Promise<void> {
  const content = parseContent(args.contentRaw);

  switch (args.eventName) {
    case EVENT_PUBLISH_COMPLETE:
    case EVENT_PUBLISH_FAILED:
      return handlePublishCompleteOrFailed(ctx, args, content);
    case EVENT_PUBLICLY_AVAILABLE:
      return handlePubliclyAvailable(ctx, args, content);
    case EVENT_NO_LONGER_PUBLICALY_AVAILABLE:
      return handleNoLongerPubliclyAvailable(ctx, args, content);
    case EVENT_AUTH_REMOVED:
      return handleAuthRemoved(ctx, args);
    default:
      console.log(`[tiktok-webhook] unhandled event type: ${args.eventName || "(missing)"}`);
      return;
  }
}

async function stampProcessed(svc: DbClient, eventRowId: string, now: () => Date): Promise<void> {
  const { error } = await svc
    .from("tiktok_webhook_events")
    .update({ processed_at: now().toISOString() })
    .eq("id", eventRowId);
  if (error) {
    console.error(`[tiktok-webhook] failed to stamp processed_at for event ${eventRowId}:`, error.message);
  }
}

/** Runs entirely AFTER the 200 has been sent (via waitUntil). Never lets a processing error
 * escape — an uncaught exception here would be a background-task crash with nowhere to report
 * to; instead it's logged and processed_at is deliberately left NULL (design doc: "Unprocessed
 * rows ... are swept by the next tiktok-publish-cron run; the status-polling phase independently
 * converges state anyway" — not this function's job to retry). */
async function processTikTokWebhookEvent(ctx: ProcessCtx, args: ProcessArgs): Promise<void> {
  try {
    await routeEvent(ctx, args);
    await stampProcessed(ctx.svc, args.eventRowId, ctx.now);
  } catch (err) {
    console.error(
      `[tiktok-webhook] processing crashed for event ${args.eventRowId} (${args.eventName || "(missing)"}):`,
      errorMessage(err),
    );
  }
}

export function createTikTokWebhookHandler(deps: TikTokWebhookDeps) {
  const getFreshToken = deps.getFreshTikTokToken ?? realGetFreshTikTokToken;
  const tiktokFetchFn = deps.tiktokFetch ?? realTiktokFetch;
  const confirmAndApply = deps.confirmAndApplyPublishStatus ?? realConfirmAndApplyPublishStatus;
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date());

  return async (req: Request): Promise<Response> => {
    const corsHeaders = deps.buildCorsHeaders(req);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return new Response(null, { status: 405, headers: corsHeaders });
    }

    let payload: TikTokWebhookPayload;
    try {
      payload = (await req.json()) as TikTokWebhookPayload;
    } catch {
      // Malformed JSON isn't something TikTok's own webhook sender would send — nothing durable
      // to persist, and retrying won't fix a body we can't parse. Drop silently.
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    // (a1) client_key must match — a mismatch is either a misconfigured/rotated key or a
    // forged request; neither is fixed by a retry, so 200 + drop (no insert).
    if (!payload.client_key || payload.client_key !== deps.tiktokClientKey) {
      console.error("[tiktok-webhook] client_key mismatch — dropping event");
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    const svc = deps.createServiceDb();

    // (a2) user_openid must resolve to a known account — unknown -> 200 + drop (no insert).
    const userOpenid = payload.user_openid ?? "";
    const { data: account, error: accountError } = await svc
      .from("tiktok_accounts")
      .select("id, username, client_id, authorization_status")
      .eq("tiktok_open_id", userOpenid)
      .maybeSingle();
    if (accountError) {
      console.error("[tiktok-webhook] account lookup failed:", accountError.message);
      return new Response(null, { status: 500, headers: corsHeaders });
    }
    if (!account) {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    // (b) Persist the raw event BEFORE responding — awaited, so the 200 below can only be sent
    // once this insert has actually committed (or the handler has already returned 500).
    const eventRowId = randomUUID();
    const { error: insertError } = await svc.from("tiktok_webhook_events").insert({
      id: eventRowId,
      event: payload.event ?? "",
      user_openid: userOpenid,
      payload,
    });
    if (insertError) {
      console.error("[tiktok-webhook] failed to persist event — returning 500 for TikTok to retry:", insertError.message);
      return new Response(null, { status: 500, headers: corsHeaders });
    }

    // (c) 200 first. (d) THEN kick off processing in the background.
    deps.waitUntil(
      processTikTokWebhookEvent(
        { svc, getFreshToken, tiktokFetchFn, confirmAndApply, now },
        {
          eventRowId,
          eventName: payload.event ?? "",
          account: account as TikTokAccountRow,
          contentRaw: payload.content,
        },
      ),
    );

    return new Response(null, { status: 200, headers: corsHeaders });
  };
}
