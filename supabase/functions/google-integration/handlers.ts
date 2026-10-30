// supabase/functions/google-integration/handlers.ts
//
// Route handlers for the Google (YouTube + Google Meu Negócio) connect surface, DI'd so they
// are testable without a live Supabase project (the tiktok-integration/handlers.ts pattern).
// index.ts does env wiring only. Google calls go through _shared/google.ts, which uses the
// global `fetch` (tests stub `globalThis.fetch`).
//
// Errors never leak details: JSON routes answer `{ error: <code> }`, the callback redirects
// with only the `{yt|gmn}_error` codes the CRM knows, and everything else is logged here.

import { insertAuditLog } from "../_shared/audit.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  buildGoogleAuthUrl,
  encryptGoogleToken,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  getFreshGoogleToken,
  GOOGLE_PRODUCT_SCOPES,
  GoogleApiError,
  googleFetch,
  type GoogleProduct,
  hasRequiredScopes,
  revokeGoogleToken,
} from "../_shared/google.ts";
import { processUnlinkDecisionData } from "../_shared/google-revocations.ts";
import * as gbpApi from "../_shared/gbp-api.ts";
import { GBP_LOCATION_COLUMNS, type GbpLocationRow, syncGbpLocation } from "../_shared/gbp-sync.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import * as youtubeApi from "../_shared/youtube-api.ts";
import { drainYoutubePdfPurges, type StorageLike } from "../_shared/youtube-pdf-purges.ts";
import {
  MAX_VIDEO_REPORTS_PER_RUN,
  syncYouTubeChannel,
  YOUTUBE_CHANNEL_SYNC_COLUMNS,
  type YoutubeChannelRow,
} from "../_shared/youtube-sync.ts";
import { type GbpLocationOption, listGbpLocations } from "./locations.ts";
import { createGoogleState, verifyGoogleState, type VerifiedGoogleState } from "./oauth-state.ts";
import { type DbClient, loadClientInTenant, resolveTenant } from "./tenant.ts";

export interface GoogleIntegrationDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createServiceDb: () => DbClient;
  /** Clock override for tests; defaults to the real time. */
  now?: () => Date;
  /** Unit syncs for POST /sync (tests inject fakes; the real ones are tested on their own). */
  syncYouTubeChannel?: typeof syncYouTubeChannel;
  syncGbpLocation?: typeof syncGbpLocation;
  /** Storage for the YouTube PDF purge drain; defaults to the service client's storage. */
  storage?: StorageLike;
}

/** Same bounds as youtube-sync-cron's drain: what one request removes is this tenant's queue. */
const PDF_PURGE_LIMIT = 50;
const PDF_PURGE_MAX_ATTEMPTS = 10;
/** Manual sync budget per client and product (globals: 5 per 300 s). */
const SYNC_RATE_LIMIT = 5;
const SYNC_RATE_WINDOW_S = 300;

/**
 * Removes the Storage objects of this tenant's report PDFs that a YouTube purge queued. Runs
 * after the purge committed and never fails the request: leftovers are retried by
 * youtube-sync-cron.
 */
async function drainTenantPdfPurges(svc: DbClient, deps: GoogleIntegrationDeps, contaId: string): Promise<void> {
  try {
    const storage = deps.storage ?? (svc.storage as StorageLike);
    await drainYoutubePdfPurges(svc, {
      storage,
      contaId,
      limit: PDF_PURGE_LIMIT,
      maxAttempts: PDF_PURGE_MAX_ATTEMPTS,
    });
  } catch (err) {
    console.error("[google-integration] PDF purge drain failed:", (err as Error).message);
  }
}

const PRODUCT_FEATURE: Record<GoogleProduct, string> = {
  youtube: "feature_youtube",
  gbp: "feature_google_business",
};

const YOUTUBE_CHANNELS_URL =
  "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true";

function json(cors: Record<string, string>, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function isProduct(value: string | null): value is GoogleProduct {
  return value === "youtube" || value === "gbp";
}

function oauthRedirectBase(): string {
  return (Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:5173").replace(/\/+$/, "");
}

/** The CRM tab the callback lands on. */
function clientTarget(clientId: string | number): string {
  return `${oauthRedirectBase()}/clientes/${clientId}/redes-sociais`;
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

// ─── GET /auth/:clientId?product=youtube|gbp ──────────────────────────────────────────

async function handleAuth(
  svc: DbClient,
  req: Request,
  path: string,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const tenant = await resolveTenant(req, svc, cors);
  if (tenant instanceof Response) return tenant;

  const rawClientId = path.split("/")[2];
  if (!rawClientId || !/^\d+$/.test(rawClientId)) return json(cors, { error: "invalid_client" }, 400);
  const clientId = parseInt(rawClientId, 10);

  const product = url.searchParams.get("product");
  if (!isProduct(product)) return json(cors, { error: "invalid_product" }, 400);

  const client = await loadClientInTenant(svc, clientId, tenant.contaId);
  if (!client) return json(cors, { error: "not_found" }, 404);

  const feature = PRODUCT_FEATURE[product];
  // deno-lint-ignore no-explicit-any
  if (!(await effectivePlanFeature(svc as any, tenant.contaId, feature))) {
    return json(cors, { error: "feature_disabled", feature }, 403);
  }

  const state = await createGoogleState(
    { clientId: String(clientId), userId: tenant.userId, contaId: tenant.contaId, product, consentRetry: false },
    svc,
  );
  return json(cors, { url: buildGoogleAuthUrl({ product, state, consent: false }) });
}

// ─── GET /callback?code&state (no JWT) ───────────────────────────────────────────────

class CallbackOutcome {
  constructor(readonly location: string) {}
}

async function handleCallback(svc: DbClient, url: URL, deps: GoogleIntegrationDeps): Promise<Response> {
  let state: VerifiedGoogleState;
  try {
    state = await verifyGoogleState(url.searchParams.get("state") ?? "", svc);
  } catch (err) {
    // Forged, expired, replayed or malformed: no redirect, no Google call.
    console.error("[google-integration] callback state rejected:", (err as Error).message);
    return new Response("Link inválido ou expirado", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const p = state.product === "youtube" ? "yt" : "gmn";
  const target = clientTarget(state.clientId);
  const fail = (code: string, extra = "") => redirect(`${target}?${p}_error=${code}${extra}`);

  try {
    const outcome = await runCallback(svc, url, state, target, fail, deps);
    return outcome instanceof CallbackOutcome ? redirect(outcome.location) : outcome;
  } catch (err) {
    console.error(`[google-integration] callback (${state.product}) failed:`, (err as Error).message);
    return fail("unknown");
  }
}

async function runCallback(
  svc: DbClient,
  url: URL,
  state: VerifiedGoogleState,
  target: string,
  fail: (code: string, extra?: string) => Response,
  deps: GoogleIntegrationDeps,
): Promise<Response | CallbackOutcome> {
  const clientId = parseInt(state.clientId, 10);
  // The client may have been deleted or moved during the 10-minute window.
  if (!Number.isFinite(clientId) || !(await loadClientInTenant(svc, clientId, state.contaId))) {
    return fail("unknown");
  }

  const googleError = url.searchParams.get("error");
  if (googleError) return fail(googleError === "access_denied" ? "denied" : "unknown");

  const code = url.searchParams.get("code");
  if (!code) return fail("unknown");

  const grant = await exchangeGoogleCode(code);
  const userInfo = await fetchGoogleUserInfo(grant.accessToken);
  const grantToken = grant.refreshToken ?? grant.accessToken;

  // An email unticked on granular consent is a missing scope too: the connection needs it.
  if (!hasRequiredScopes(state.product, grant.scopes) || userInfo.email === null) {
    // A just-minted partial grant still counts toward Google's per-account token cap, but
    // with include_granted_scopes it is the same grant any existing connection uses.
    await revokeIfUnused(svc, userInfo.sub, grantToken);
    return fail("missing_scope");
  }
  const user = { ...userInfo, email: userInfo.email };

  // YouTube product checks run BEFORE anything is written, with the fresh access token, so a
  // failure never leaves a connection row (or an orphan grant) behind. They also run before
  // the refresh-token gate, so a doomed flow is not bounced through a consent screen first.
  let channel: YouTubeChannelItem & { id: string } | null = null;
  if (state.product === "youtube") {
    channel = await fetchOwnYouTubeChannel(grant.accessToken);
    if (!channel) {
      await revokeIfUnused(svc, user.sub, grantToken);
      return fail("no_channel");
    }
    const owner = await findOtherChannelOwner(svc, state.contaId, channel.id, clientId);
    if (owner) {
      await revokeIfUnused(svc, user.sub, grantToken);
      return fail("channel_in_use", owner.name ? `&yt_other=${encodeURIComponent(owner.name)}` : "");
    }
  }

  if (grant.refreshToken === null) {
    const { data: covers, error: coversError } = await svc.rpc("google_connection_refresh_covers", {
      p_conta_id: state.contaId,
      p_sub: user.sub,
      p_scopes: GOOGLE_PRODUCT_SCOPES[state.product],
    });
    if (coversError) throw new Error(`refresh_covers failed: ${coversError.message}`);
    if (covers !== true) {
      if (state.consentRetry) return fail("no_refresh_token");
      const retryState = await createGoogleState(
        {
          clientId: state.clientId,
          userId: state.userId,
          contaId: state.contaId,
          product: state.product,
          consentRetry: true,
        },
        svc,
      );
      return new CallbackOutcome(buildGoogleAuthUrl({ product: state.product, state: retryState, consent: true }));
    }
  }

  const { data: connectionId, error: upsertError } = await svc.rpc("google_connection_upsert", {
    p_conta_id: state.contaId,
    p_sub: user.sub,
    p_email: user.email,
    p_display_name: user.name,
    p_access_enc: await encryptGoogleToken(grant.accessToken, "access"),
    p_refresh_enc: grant.refreshToken === null ? null : await encryptGoogleToken(grant.refreshToken, "refresh"),
    p_expires_at: grant.expiresAt.toISOString(),
    p_scopes: grant.scopes,
  });
  if (upsertError || typeof connectionId !== "string" || !connectionId) {
    throw new Error(`google_connection_upsert failed: ${upsertError?.message ?? "no id returned"}`);
  }

  let success: string;
  if (channel) {
    const relink = await prepareYouTubeRelink(svc, deps, state, clientId, connectionId, channel.id, user.sub);
    const result = await linkYouTubeChannel(svc, state.contaId, clientId, connectionId, channel, {
      resetWatermarks: relink.resetWatermarks,
    });
    if (result.kind === "in_use") {
      // Race backstop: another client linked the channel between the pre-check and here. The
      // connection row now exists, so the grant is in use and is NOT revoked.
      return fail("channel_in_use", result.otherName ? `&yt_other=${encodeURIComponent(result.otherName)}` : "");
    }
    if (relink.releaseSub) {
      // Same channel, now through another Google account: the old account may hold nothing else.
      const { data, error } = await svc.rpc("google_release_sub", { p_sub: relink.releaseSub });
      if (error) {
        // Non-fatal: the channel is linked; the orphan sweep releases the sub later.
        console.error(`[google-integration] google_release_sub failed: ${error.message}`);
      } else {
        await processUnlinkDecisionData(svc, data);
      }
    }
    success = `${target}?yt_connected=1`;
  } else {
    // GMN: the location picker in the CRM lists the connection's locations (Task 7).
    success = `${target}?gbp_pick=${encodeURIComponent(connectionId)}`;
  }

  await insertAuditLog(svc, {
    conta_id: state.contaId,
    actor_user_id: state.userId,
    action: "google-connect",
    resource_type: "google_connection",
    resource_id: connectionId,
    metadata: { product: state.product, client_id: clientId },
  });

  return new CallbackOutcome(success);
}

/**
 * Revokes a grant only when no `google_connections` row in ANY workspace uses this Google
 * identity. With include_granted_scopes every flow for one Google user + our OAuth client is
 * one combined grant, so revoking it would kill connections already in use elsewhere. A lookup
 * error skips the revoke (fail safe: an orphan grant beats a killed connection).
 */
async function revokeIfUnused(svc: DbClient, sub: string, token: string): Promise<void> {
  const { data, error } = await svc.from("google_connections").select("id").eq("google_sub", sub).limit(1);
  if (error) {
    console.error(`[google-integration] connection lookup failed, revoke skipped: ${error.message}`);
    return;
  }
  if (Array.isArray(data) && data.length > 0) return;
  if (!(await revokeGoogleToken(token))) {
    console.error("[google-integration] revoking an unused partial grant failed");
  }
}

// ─── YouTube product step ───────────────────────────────────────────────────────────

interface YouTubeChannelItem {
  id?: string;
  snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; viewCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

function toCount(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchOwnYouTubeChannel(accessToken: string): Promise<(YouTubeChannelItem & { id: string }) | null> {
  const body = (await googleFetch(YOUTUBE_CHANNELS_URL, accessToken)) as { items?: YouTubeChannelItem[] } | null;
  const channel = body?.items?.[0];
  return channel?.id ? (channel as YouTubeChannelItem & { id: string }) : null;
}

/** Another client of the same workspace already holding this channel, if any. */
async function findOtherChannelOwner(
  svc: DbClient,
  contaId: string,
  channelId: string,
  clientId: number,
): Promise<{ name: string | null } | null> {
  const { data, error } = await svc
    .from("youtube_channels")
    .select("client_id")
    .eq("conta_id", contaId)
    .eq("channel_id", channelId)
    .neq("client_id", clientId)
    .limit(1);
  if (error) throw new Error(`youtube_channels pre-check failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  const other = await loadClientInTenant(svc, row.client_id as number, contaId);
  return { name: other?.nome ?? null };
}

type LinkResult = { kind: "linked" } | { kind: "in_use"; otherName: string | null };

/**
 * P11, run after the connection upsert and before the channel write. The client's stored row:
 * - another channel_id: unlink it first (google_unlink_youtube purges its history, decides the
 *   revoke, deletes the row), so no history is orphaned and the new channel backfills from NULL
 *   watermarks;
 * - the same channel_id on another connection: keep the row and its history, and return the old
 *   connection's sub so the caller releases it after the write (captured now, before the row
 *   moves to the new connection).
 * The connection upsert runs first on purpose: when the old and new channel share the Google
 * account, the fresh authorized_at keeps the sub "in use" and the unlink does not revoke it.
 */
async function prepareYouTubeRelink(
  svc: DbClient,
  deps: GoogleIntegrationDeps,
  state: VerifiedGoogleState,
  clientId: number,
  connectionId: string,
  channelId: string,
  newSub: string,
): Promise<{ resetWatermarks: boolean; releaseSub: string | null }> {
  const { data, error } = await svc
    .from("youtube_channels")
    .select("channel_id, connection_id")
    .eq("conta_id", state.contaId)
    .eq("client_id", clientId)
    .limit(1);
  if (error) throw new Error(`youtube_channels stored row read failed: ${error.message}`);
  type StoredChannel = { channel_id: string; connection_id: string | null };
  const stored = Array.isArray(data) ? (data[0] as StoredChannel | undefined) : undefined;
  if (!stored) return { resetWatermarks: false, releaseSub: null };

  if (stored.channel_id !== channelId) {
    const { data: decision, error: unlinkError } = await svc.rpc("google_unlink_youtube", {
      p_conta_id: state.contaId,
      p_client_id: clientId,
    });
    if (unlinkError) {
      // P0002: a concurrent disconnect removed it meanwhile; the insert below proceeds.
      if (unlinkError.code !== "P0002") throw new Error(`google_unlink_youtube failed: ${unlinkError.message}`);
      return { resetWatermarks: true, releaseSub: null };
    }
    await processUnlinkDecisionData(svc, decision);
    await drainTenantPdfPurges(svc, deps, state.contaId);
    await insertAuditLog(svc, {
      conta_id: state.contaId,
      actor_user_id: state.userId,
      action: "youtube-unlink",
      resource_type: "youtube_channel",
      metadata: { client_id: clientId, reason: "relink", channel_id: stored.channel_id },
    });
    return { resetWatermarks: true, releaseSub: null };
  }

  if (!stored.connection_id || stored.connection_id === connectionId) {
    return { resetWatermarks: false, releaseSub: null };
  }
  const { data: old, error: oldError } = await svc
    .from("google_connections")
    .select("google_sub")
    .eq("id", stored.connection_id)
    .eq("conta_id", state.contaId)
    .maybeSingle();
  if (oldError) {
    // Non-fatal: without the sub there is nothing to release; the orphan sweep covers it.
    console.error(`[google-integration] old connection sub read failed: ${oldError.message}`);
    return { resetWatermarks: false, releaseSub: null };
  }
  const oldSub = typeof old?.google_sub === "string" ? old.google_sub : null;
  return { resetWatermarks: false, releaseSub: oldSub && oldSub !== newSub ? oldSub : null };
}

async function linkYouTubeChannel(
  svc: DbClient,
  contaId: string,
  clientId: number,
  connectionId: string,
  channel: YouTubeChannelItem & { id: string },
  opts: { resetWatermarks: boolean },
): Promise<LinkResult> {
  const stats = channel.statistics ?? {};
  // A different channel than the stored one starts from NULL watermarks (P11) even if the
  // unlink's row delete raced this write; the same channel keeps them.
  const reset = opts.resetWatermarks
    ? {
      data_through: null,
      content_type_through: null,
      traffic_through: null,
      videos_through: null,
      last_synced_at: null,
    }
    : {};
  const { error } = await svc.from("youtube_channels").upsert(
    {
      ...reset,
      conta_id: contaId,
      client_id: clientId,
      connection_id: connectionId,
      channel_id: channel.id,
      title: channel.snippet?.title ?? null,
      handle: channel.snippet?.customUrl ?? null,
      avatar_url: channel.snippet?.thumbnails?.default?.url ?? null,
      uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
      subscriber_count: stats.hiddenSubscriberCount ? null : toCount(stats.subscriberCount),
      view_count: toCount(stats.viewCount),
      video_count: toCount(stats.videoCount),
      authorization_status: "active",
      revoked_at: null,
    },
    { onConflict: "client_id" },
  );

  if (!error) return { kind: "linked" };
  if (error.code !== "23505") throw new Error(`youtube_channels upsert failed: ${error.message}`);

  // (conta_id, channel_id) is taken by another client of this workspace: name it.
  const { data: other } = await svc
    .from("youtube_channels")
    .select("client_id")
    .eq("conta_id", contaId)
    .eq("channel_id", channel.id)
    .maybeSingle();
  const otherClient = other?.client_id ? await loadClientInTenant(svc, other.client_id as number, contaId) : null;
  return { kind: "in_use", otherName: otherClient?.nome ?? null };
}

// ─── Shared route guards ─────────────────────────────────────────────────────────────

const GBP_SCOPE = GOOGLE_PRODUCT_SCOPES.gbp[0];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCATION_NAME_RE = /^locations\/[^/\s]+$/;
const MAX_LOCATIONS_PER_SAVE = 200;

/**
 * Tenant + `:clientId` (path segment 2 or 3) loaded inside the tenant. Phase 1 routes answer a
 * foreign client with 404; the sync routes answer 403 (globals: "403 for a foreign client, as in
 * tiktok-analytics").
 */
async function requireClient(
  svc: DbClient,
  req: Request,
  rawClientId: string,
  cors: Record<string, string>,
  foreign: "not_found" | "forbidden" = "not_found",
): Promise<{ userId: string; contaId: string; clientId: number } | Response> {
  const tenant = await resolveTenant(req, svc, cors);
  if (tenant instanceof Response) return tenant;
  if (!/^\d+$/.test(rawClientId)) return json(cors, { error: "invalid_client" }, 400);
  const clientId = parseInt(rawClientId, 10);
  if (!(await loadClientInTenant(svc, clientId, tenant.contaId))) {
    return foreign === "forbidden" ? json(cors, { error: "forbidden" }, 403) : json(cors, { error: "not_found" }, 404);
  }
  return { ...tenant, clientId };
}

async function requireGbpFeature(svc: DbClient, contaId: string, cors: Record<string, string>): Promise<Response | null> {
  // deno-lint-ignore no-explicit-any
  if (await effectivePlanFeature(svc as any, contaId, PRODUCT_FEATURE.gbp)) return null;
  return json(cors, { error: "feature_disabled", feature: PRODUCT_FEATURE.gbp }, 403);
}

/** The connection must belong to the tenant; checked before any Google call. */
async function connectionInTenant(svc: DbClient, connectionId: string, contaId: string): Promise<boolean> {
  if (!UUID_RE.test(connectionId)) return false;
  const { data, error } = await svc
    .from("google_connections")
    .select("id, status")
    .eq("id", connectionId)
    .eq("conta_id", contaId)
    .maybeSingle();
  if (error) throw new Error(`connection lookup failed: ${error.message}`);
  return !!data;
}

/** Each listing walks every GBP account of the connection, so it is rate-limited per workspace. */
async function locationsRateLimited(svc: DbClient, contaId: string): Promise<boolean> {
  // deno-lint-ignore no-explicit-any
  return !(await checkRateLimit(svc as any, `google-locations:${contaId}`, 20, 60));
}

/** R2: NOT_APPROVED / REVOKED have their own codes; every other Google failure is 502 unknown. */
function googleErrorResponse(err: GoogleApiError, cors: Record<string, string>): Response {
  if (err.code === "NOT_APPROVED") return json(cors, { error: "gmn_not_approved" }, 409);
  if (err.code === "REVOKED") return json(cors, { error: "reconnect" }, 409);
  if (err.code === "API_DISABLED") {
    console.error("[google-integration] Google API disabled in the Cloud project:", err.message);
  }
  return json(cors, { error: "unknown" }, 502);
}

// ─── GET /summary/:clientId ──────────────────────────────────────────────────────────

async function handleSummary(svc: DbClient, req: Request, rawClientId: string, cors: Record<string, string>) {
  const ctx = await requireClient(svc, req, rawClientId, cors);
  if (ctx instanceof Response) return ctx;

  // deno-lint-ignore no-explicit-any
  const ytOn = await effectivePlanFeature(svc as any, ctx.contaId, PRODUCT_FEATURE.youtube);
  // deno-lint-ignore no-explicit-any
  const gbpOn = await effectivePlanFeature(svc as any, ctx.contaId, PRODUCT_FEATURE.gbp);

  let youtube: Record<string, unknown> | null = null;
  if (ytOn) {
    const { data: ch, error } = await svc
      .from("youtube_channels")
      .select(
        "channel_id, title, handle, avatar_url, subscriber_count, view_count, video_count, authorization_status, last_synced_at, connection_id",
      )
      .eq("client_id", ctx.clientId)
      .eq("conta_id", ctx.contaId)
      .maybeSingle();
    if (error) throw new Error(`youtube_channels read failed: ${error.message}`);
    if (ch) {
      const { data: conn, error: connError } = await svc
        .from("google_connections")
        .select("email")
        .eq("id", ch.connection_id)
        .eq("conta_id", ctx.contaId)
        .maybeSingle();
      if (connError) {
        // Non-fatal: the summary still renders, without the account email.
        console.error(`[google-integration] summary connection email read failed: ${connError.message}`);
      }
      youtube = {
        channelId: ch.channel_id,
        title: ch.title ?? null,
        handle: ch.handle ?? null,
        avatarUrl: ch.avatar_url ?? null,
        subscriberCount: ch.subscriber_count ?? null,
        viewCount: ch.view_count ?? null,
        videoCount: ch.video_count ?? null,
        authorizationStatus: ch.authorization_status,
        connectionEmail: conn?.email ?? null,
        lastSyncedAt: ch.last_synced_at ?? null,
      };
    }
  }

  let gmn: Record<string, unknown> | null = null;
  if (gbpOn) {
    const { data: locs, error: locError } = await svc
      .from("gbp_locations")
      .select("id, title, address_line, average_rating, total_review_count, status")
      .eq("client_id", ctx.clientId)
      .eq("conta_id", ctx.contaId)
      .in("status", ["active", "revoked"])
      .order("title", { ascending: true });
    if (locError) throw new Error(`gbp_locations read failed: ${locError.message}`);
    const { data: conns, error: connError } = await svc
      .from("google_connections")
      .select("id, email, status")
      .eq("conta_id", ctx.contaId)
      .contains("scopes", [GBP_SCOPE])
      .order("email", { ascending: true });
    if (connError) throw new Error(`google_connections read failed: ${connError.message}`);
    gmn = {
      locations: (locs ?? []).map((l: Record<string, unknown>) => ({
        id: l.id,
        title: l.title ?? null,
        addressLine: l.address_line ?? null,
        averageRating: l.average_rating === null || l.average_rating === undefined ? null : Number(l.average_rating),
        totalReviewCount: l.total_review_count ?? null,
        status: l.status,
      })),
      connections: (conns ?? []).map((c: Record<string, unknown>) => ({ id: c.id, email: c.email, status: c.status })),
    };
  }

  return json(cors, { youtube, gmn });
}

// ─── GET /locations/:clientId?connection=<uuid> ──────────────────────────────────────

interface LinkedRow {
  id?: string;
  location_name: string;
  client_id: number;
  connection_id?: string | null;
  status: string;
}

interface StoredLocationRow extends LinkedRow {
  account_name?: string | null;
  title?: string | null;
  address_line?: string | null;
  website?: string | null;
  has_voice_of_merchant?: boolean | null;
  maps_uri?: string | null;
}

async function handleListLocations(
  svc: DbClient,
  req: Request,
  rawClientId: string,
  url: URL,
  cors: Record<string, string>,
) {
  const ctx = await requireClient(svc, req, rawClientId, cors);
  if (ctx instanceof Response) return ctx;
  const gate = await requireGbpFeature(svc, ctx.contaId, cors);
  if (gate) return gate;

  const connectionId = url.searchParams.get("connection") ?? "";
  if (!(await connectionInTenant(svc, connectionId, ctx.contaId))) return json(cors, { error: "not_found" }, 404);
  if (await locationsRateLimited(svc, ctx.contaId)) return json(cors, { error: "rate_limited" }, 429);

  const token = await getFreshGoogleToken(svc, connectionId);
  const { options, truncated } = await listGbpLocations(token);
  // `truncated` (account cap or time budget hit): the picker says only part of the account is
  // shown. This client's units on this connection are appended below either way.
  const extra = truncated ? { truncated: true } : {};

  // Units of this workspace that already belong to a client (active or awaiting reconnect),
  // matched in memory: the listed names can be hundreds, too many for a URL filter.
  const { data: linked, error } = await svc
    .from("gbp_locations")
    .select(
      "location_name, client_id, connection_id, status, account_name, title, address_line, website, has_voice_of_merchant, maps_uri",
    )
    .eq("conta_id", ctx.contaId)
    .in("status", ["active", "revoked"]);
  if (error) throw new Error(`gbp_locations read failed: ${error.message}`);
  const linkedRows = (linked ?? []) as StoredLocationRow[];
  const listedNames = new Set(options.map((o) => o.locationName));
  const linkedBy = new Map<string, LinkedRow>(
    linkedRows.filter((r) => listedNames.has(r.location_name)).map((r) => [r.location_name, r]),
  );
  // This client's units on THIS connection that the listing did not return (an account past
  // the walk's bounds, or Google stopped listing it). The picker seeds its checked set from
  // these options, so leaving them out would make the next save unlink them.
  const unlistedMine = linkedRows.filter((r) =>
    r.client_id === ctx.clientId && r.connection_id === connectionId && !listedNames.has(r.location_name)
  );

  const clientIds = [...new Set([...linkedBy.values()].map((r) => r.client_id))];
  if (unlistedMine.length && !clientIds.includes(ctx.clientId)) clientIds.push(ctx.clientId);
  const names = new Map<number, string>();
  if (clientIds.length) {
    const { data: clients, error: clientError } = await svc
      .from("clientes")
      .select("id, nome")
      .eq("conta_id", ctx.contaId)
      .in("id", clientIds);
    if (clientError) throw new Error(`clientes read failed: ${clientError.message}`);
    for (const c of (clients ?? []) as Array<{ id: number; nome: string }>) names.set(c.id, c.nome);
  }

  return json(cors, {
    ...extra,
    options: options.map((o) => {
      const row = linkedBy.get(o.locationName);
      const linkedClientId = row ? row.client_id : null;
      const takenByOther = linkedClientId !== null && linkedClientId !== ctx.clientId;
      // R7 mirror: a unit this client already has on this connection stays selectable even if
      // Google stopped reporting it verified, so the picker never forces an unlink.
      const keptHere = !!row && row.client_id === ctx.clientId && row.connection_id === connectionId &&
        row.status === "active";
      return {
        ...o,
        linkedClientId,
        linkedClientName: linkedClientId !== null ? names.get(linkedClientId) ?? null : null,
        // R12: a unit of this client on ANOTHER connection is shown checked and locked by the
        // picker, and POST ignores it; only the connection that linked it manages it.
        linkedConnectionId: row?.connection_id ?? null,
        eligible: keptHere || (o.hasVoiceOfMerchant && !takenByOther),
      };
    }).concat(
      unlistedMine.map((r) => ({
        locationName: r.location_name,
        accountName: r.account_name ?? "",
        title: r.title ?? r.location_name,
        addressLine: r.address_line ?? null,
        website: r.website ?? null,
        hasVoiceOfMerchant: r.has_voice_of_merchant === true,
        mapsUri: r.maps_uri ?? null,
        linkedClientId: ctx.clientId,
        linkedClientName: names.get(ctx.clientId) ?? null,
        linkedConnectionId: connectionId,
        eligible: true, // R7: already linked here
      })),
    ),
  });
}

// ─── POST /locations/:clientId { connectionId, locationNames } ───────────────────────

function parseLinkBody(body: unknown): { connectionId: string; locationNames: string[] } | null {
  if (!body || typeof body !== "object") return null;
  const { connectionId, locationNames } = body as Record<string, unknown>;
  if (typeof connectionId !== "string" || !UUID_RE.test(connectionId)) return null;
  if (!Array.isArray(locationNames) || locationNames.length > MAX_LOCATIONS_PER_SAVE) return null;
  if (!locationNames.every((n) => typeof n === "string" && LOCATION_NAME_RE.test(n))) return null;
  return { connectionId, locationNames: [...new Set(locationNames as string[])] };
}

async function handleLinkLocations(svc: DbClient, req: Request, rawClientId: string, cors: Record<string, string>) {
  const ctx = await requireClient(svc, req, rawClientId, cors);
  if (ctx instanceof Response) return ctx;
  const gate = await requireGbpFeature(svc, ctx.contaId, cors);
  if (gate) return gate;

  let parsed: ReturnType<typeof parseLinkBody>;
  try {
    parsed = parseLinkBody(await req.json());
  } catch {
    parsed = null;
  }
  if (!parsed) return json(cors, { error: "invalid_body" }, 400);
  const { connectionId } = parsed;

  if (!(await connectionInTenant(svc, connectionId, ctx.contaId))) return json(cors, { error: "not_found" }, 404);
  // The save re-lists every account too, so it shares the listing budget.
  if (await locationsRateLimited(svc, ctx.contaId)) return json(cors, { error: "rate_limited" }, 429);

  // I3: a dead connection (REVOKED) cannot list, but an empty save on it only unlinks, which
  // needs no Google call. Anything else on a dead connection still answers 409 reconnect.
  let fromGoogle = new Map<string, GbpLocationOption>();
  let token: string | null = null;
  try {
    token = await getFreshGoogleToken(svc, connectionId);
  } catch (err) {
    if (!(err instanceof GoogleApiError && err.code === "REVOKED" && parsed.locationNames.length === 0)) throw err;
  }
  if (token !== null) {
    // A truncated listing only means fewer new names are accepted (409), never a wrong link.
    const listing = await listGbpLocations(token);
    fromGoogle = new Map(listing.options.map((o) => [o.locationName, o]));
  }

  let requestedRows: LinkedRow[] = [];
  if (parsed.locationNames.length) {
    const { data, error } = await svc
      .from("gbp_locations")
      .select("id, location_name, client_id, connection_id, status")
      .eq("conta_id", ctx.contaId)
      .in("location_name", parsed.locationNames);
    if (error) throw new Error(`gbp_locations read failed: ${error.message}`);
    requestedRows = (data ?? []) as LinkedRow[];
  }
  const requestedBy = new Map(requestedRows.map((r) => [r.location_name, r]));

  // R12: a unit this client holds through ANOTHER connection belongs to that connection's
  // picker. Sent here it is ignored: no 409, no update (which would move it to this
  // connection), and it is outside `mine` below, so it is never unlinked either.
  const locationNames = parsed.locationNames.filter((name) => {
    const row = requestedBy.get(name);
    return !(row && row.client_id === ctx.clientId && row.status !== "disconnected" &&
      row.connection_id !== connectionId);
  });

  // This client's units on THIS connection, active or awaiting reconnect: the only ones this
  // save may unlink. A revoked unit left unchecked is unlinked too.
  const { data: mineData, error: mineError } = await svc
    .from("gbp_locations")
    .select("id, location_name")
    .eq("conta_id", ctx.contaId)
    .eq("client_id", ctx.clientId)
    .eq("connection_id", connectionId)
    .in("status", ["active", "revoked"]);
  if (mineError) throw new Error(`gbp_locations read failed: ${mineError.message}`);
  const mine = (mineData ?? []) as Array<{ id: string; location_name: string }>;
  const keptHere = new Set(mine.map((r) => r.location_name));

  // Validate everything before writing anything. R7: a unit already linked to this client on
  // this connection stays accepted even if Google no longer reports it eligible.
  for (const name of locationNames) {
    if (keptHere.has(name)) continue;
    const option = fromGoogle.get(name);
    const row = requestedBy.get(name);
    const takenByOther = !!row && row.client_id !== ctx.clientId && row.status !== "disconnected";
    if (!option || !option.hasVoiceOfMerchant || takenByOther) {
      return json(cors, { error: "location_unavailable", locationName: name }, 409);
    }
  }

  // Writes BEFORE unlink: the unlink's revoke branch can delete the connection these rows
  // reference. Titles and addresses always come from Google, never from the request; a kept
  // unit Google no longer lists is left as is. R11: a row never moves between clients. This
  // client's own rows are updated in place; another client's `disconnected` row for a name is
  // deleted and a fresh row inserted, so the old client's history never follows the unit.
  const listedRows = locationNames
    .map((name) => fromGoogle.get(name))
    .filter((o): o is GbpLocationOption => !!o)
    .map((o) => ({
      account_name: o.accountName,
      location_name: o.locationName,
      title: o.title,
      address_line: o.addressLine,
      website: o.website,
      has_voice_of_merchant: o.hasVoiceOfMerchant,
      maps_uri: o.mapsUri,
    }));
  const ownRows: Array<{ id: string; fields: (typeof listedRows)[number] }> = [];
  const newRows: Array<(typeof listedRows)[number]> = [];
  const foreignDisconnected: LinkedRow[] = [];
  for (const fields of listedRows) {
    const existing = requestedBy.get(fields.location_name);
    if (existing && existing.client_id === ctx.clientId && existing.id) {
      ownRows.push({ id: existing.id, fields });
      continue;
    }
    if (existing) foreignDisconnected.push(existing); // validated above: disconnected only
    newRows.push(fields);
  }

  for (const row of foreignDisconnected) {
    const { error } = await svc
      .from("gbp_locations")
      .delete()
      .eq("id", row.id)
      .eq("conta_id", ctx.contaId)
      .eq("client_id", row.client_id)
      .eq("status", "disconnected");
    if (error) throw new Error(`gbp_locations delete failed: ${error.message}`);
  }

  if (newRows.length) {
    const { error } = await svc.from("gbp_locations").insert(
      newRows.map((fields) => ({
        ...fields,
        conta_id: ctx.contaId,
        client_id: ctx.clientId,
        connection_id: connectionId,
        status: "active",
        disconnected_at: null,
      })),
    );
    if (error) {
      if (error.code !== "23505") throw new Error(`gbp_locations insert failed: ${error.message}`);
      // Another save linked one of these units first (unique conta_id + location_name). The
      // single INSERT is atomic, so nothing of this batch landed; nothing is unlinked.
      const taken = await findTakenName(svc, ctx.contaId, ctx.clientId, newRows.map((r) => r.location_name));
      return json(cors, { error: "location_unavailable", locationName: taken }, 409);
    }
  }

  for (const { id, fields } of ownRows) {
    const { error } = await svc
      .from("gbp_locations")
      .update({ ...fields, connection_id: connectionId, status: "active", disconnected_at: null })
      .eq("id", id)
      .eq("client_id", ctx.clientId)
      .eq("conta_id", ctx.contaId);
    if (error) throw new Error(`gbp_locations update failed: ${error.message}`);
  }

  const wanted = new Set(locationNames);
  // R13: GET always shows every `mine` row (unlisted ones are appended), even on a truncated
  // listing, so a name missing from the set was unchecked on purpose.
  const removed = mine.filter((r) => !wanted.has(r.location_name));
  for (const row of removed) {
    const { data, error } = await svc.rpc("google_unlink_gbp_location", {
      p_conta_id: ctx.contaId,
      p_location_id: row.id,
    });
    if (error) {
      if (error.code === "P0002") continue; // removed concurrently
      throw new Error(`google_unlink_gbp_location failed: ${error.message}`);
    }
    await processUnlinkDecisionData(svc, data);
  }

  await insertAuditLog(svc, {
    conta_id: ctx.contaId,
    actor_user_id: ctx.userId,
    action: "gmn-link",
    resource_type: "gbp_location",
    metadata: {
      client_id: ctx.clientId,
      connection_id: connectionId,
      linked: locationNames,
      unlinked: removed.map((r) => r.location_name),
    },
  });

  return json(cors, { linked: locationNames.length });
}

/** After a 23505 on the link insert, names the unit another client now holds. */
async function findTakenName(svc: DbClient, contaId: string, clientId: number, names: string[]): Promise<string> {
  const { data } = await svc
    .from("gbp_locations")
    .select("location_name, client_id")
    .eq("conta_id", contaId)
    .in("location_name", names);
  const hit = ((data ?? []) as LinkedRow[]).find((r) => r.client_id !== clientId);
  return hit?.location_name ?? names[0];
}

// ─── POST /disconnect/youtube/:clientId ───────────────────────────────────────────────

async function handleDisconnectYouTube(
  svc: DbClient,
  req: Request,
  rawClientId: string,
  cors: Record<string, string>,
  deps: GoogleIntegrationDeps,
) {
  const ctx = await requireClient(svc, req, rawClientId, cors);
  if (ctx instanceof Response) return ctx;

  const { data, error } = await svc.rpc("google_unlink_youtube", {
    p_conta_id: ctx.contaId,
    p_client_id: ctx.clientId,
  });
  if (error) {
    if (error.code === "P0002") return json(cors, { error: "not_found" }, 404);
    throw new Error(`google_unlink_youtube failed: ${error.message}`);
  }
  await processUnlinkDecisionData(svc, data);
  // The purge queued this tenant's report PDFs that held YouTube data; remove them now.
  await drainTenantPdfPurges(svc, deps, ctx.contaId);

  await insertAuditLog(svc, {
    conta_id: ctx.contaId,
    actor_user_id: ctx.userId,
    action: "youtube-unlink",
    resource_type: "youtube_channel",
    metadata: { client_id: ctx.clientId },
  });
  return json(cors, { ok: true });
}

// ─── POST /sync/:product/:clientId ──────────────────────────────────────────────────

/**
 * Manual sync of one client's YouTube channel or GMN locations, with the cron's unit sync.
 * Order (globals): client in tenant (403), product flag (403), rate limit (429), unit lookup
 * (404 not_connected, 409 revoked). The unit's own outcome (synced, quota_skipped, skipped,
 * mismatch, not_approved, or revoked when the token died during this run) is a 200; only an
 * unexpected throw is a 500, with no details.
 */
async function handleSync(
  svc: DbClient,
  req: Request,
  product: GoogleProduct,
  rawClientId: string,
  cors: Record<string, string>,
  deps: GoogleIntegrationDeps,
): Promise<Response> {
  const ctx = await requireClient(svc, req, rawClientId, cors, "forbidden");
  if (ctx instanceof Response) return ctx;

  const feature = PRODUCT_FEATURE[product];
  // deno-lint-ignore no-explicit-any
  if (!(await effectivePlanFeature(svc as any, ctx.contaId, feature))) {
    return json(cors, { error: "feature_disabled", feature }, 403);
  }
  const rateKey = `google-sync:${ctx.contaId}:${ctx.clientId}:${product}`;
  // deno-lint-ignore no-explicit-any
  if (!(await checkRateLimit(svc as any, rateKey, SYNC_RATE_LIMIT, SYNC_RATE_WINDOW_S))) {
    return json(cors, { error: "rate_limited" }, 429);
  }

  const now = deps.now ?? (() => new Date());
  try {
    if (product === "youtube") {
      const { data, error } = await svc
        .from("youtube_channels")
        .select(YOUTUBE_CHANNEL_SYNC_COLUMNS)
        .eq("conta_id", ctx.contaId)
        .eq("client_id", ctx.clientId)
        .maybeSingle();
      if (error) throw new Error(`youtube_channels read failed: ${error.message}`);
      const channel = data as YoutubeChannelRow | null;
      if (!channel) return json(cors, { error: "not_connected" }, 404);
      if (channel.authorization_status !== "active") return json(cors, { error: "revoked" }, 409);

      const sync = deps.syncYouTubeChannel ?? syncYouTubeChannel;
      const outcome = await sync(
        { svc, api: youtubeApi, getFreshGoogleToken: (db, id) => getFreshGoogleToken(db, id), now },
        channel,
        { now: now(), maxVideoReports: MAX_VIDEO_REPORTS_PER_RUN },
      );
      return json(cors, { ok: true, status: outcome.status });
    }

    const { data, error } = await svc
      .from("gbp_locations")
      .select(GBP_LOCATION_COLUMNS)
      .eq("conta_id", ctx.contaId)
      .eq("client_id", ctx.clientId)
      .in("status", ["active", "revoked"])
      .order("id", { ascending: true });
    if (error) throw new Error(`gbp_locations read failed: ${error.message}`);
    const units = (data ?? []) as GbpLocationRow[];
    if (!units.length) return json(cors, { error: "not_connected" }, 404);
    const active = units.filter((u) => u.status === "active");
    if (!active.length) return json(cors, { error: "revoked" }, 409);

    const sync = deps.syncGbpLocation ?? syncGbpLocation;
    const syncDeps = {
      svc,
      api: gbpApi,
      getFreshGoogleToken: (db: DbClient, id: string) => getFreshGoogleToken(db, id),
      now,
      sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    };
    // Sequential: GMN quotas are per minute and low (the cron's per-location pacing).
    const locations: Array<{ id: string; status: string }> = [];
    for (const location of active) {
      const outcome = await sync(syncDeps, location, { now: now() });
      locations.push({ id: location.id, status: outcome.status });
    }
    return json(cors, { ok: true, locations });
  } catch (err) {
    return internalServerError(createJsonResponder(cors), "google-integration:sync", err);
  }
}

// ─── Dispatch ──────────────────────────────────────────────────────────────────────────

export function createGoogleIntegrationHandler(deps: GoogleIntegrationDeps) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // The edge runtime sees `/google-integration/...`; strip any prefix up to the function name
    // too (`/functions/v1/google-integration/...`) so both shapes route the same.
    const path = url.pathname.replace(/^.*?\/google-integration/, "").replace(/\/$/, "");
    const cors = deps.buildCorsHeaders(req);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const svc = deps.createServiceDb();

    try {
      if (req.method === "GET" && path === "/callback") {
        return await handleCallback(svc, url, deps);
      }
      if (req.method === "GET" && /^\/auth\/[^/]+$/.test(path)) {
        return await handleAuth(svc, req, path, url, cors);
      }
      const segs = path.split("/"); // ["", route, ...]
      if (req.method === "GET" && segs.length === 3 && segs[1] === "summary") {
        return await handleSummary(svc, req, segs[2], cors);
      }
      if (segs.length === 3 && segs[1] === "locations") {
        if (req.method === "GET") return await handleListLocations(svc, req, segs[2], url, cors);
        if (req.method === "POST") return await handleLinkLocations(svc, req, segs[2], cors);
      }
      if (req.method === "POST" && segs.length === 4 && segs[1] === "disconnect" && segs[2] === "youtube") {
        return await handleDisconnectYouTube(svc, req, segs[3], cors, deps);
      }
      if (req.method === "POST" && segs.length === 4 && segs[1] === "sync" && isProduct(segs[2])) {
        return await handleSync(svc, req, segs[2], segs[3], cors, deps);
      }
      return json(cors, { error: "not_found" }, 404);
    } catch (err) {
      if (err instanceof GoogleApiError) {
        console.error(`[google-integration] Google error ${err.code} (${err.status}): ${err.message}`);
        return googleErrorResponse(err, cors);
      }
      return internalServerError(createJsonResponder(cors), "google-integration", err);
    }
  };
}
