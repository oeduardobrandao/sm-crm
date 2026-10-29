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
import {
  buildGoogleAuthUrl,
  encryptGoogleToken,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  GOOGLE_PRODUCT_SCOPES,
  googleFetch,
  type GoogleProduct,
  hasRequiredScopes,
  revokeGoogleToken,
} from "../_shared/google.ts";
import { createGoogleState, verifyGoogleState, type VerifiedGoogleState } from "./oauth-state.ts";
import { type DbClient, loadClientInTenant, resolveTenant } from "./tenant.ts";

export interface GoogleIntegrationDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createServiceDb: () => DbClient;
  /** Clock override for tests; defaults to the real time. */
  now?: () => Date;
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

async function handleCallback(svc: DbClient, url: URL): Promise<Response> {
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
    const outcome = await runCallback(svc, url, state, target, fail);
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
  const user = await fetchGoogleUserInfo(grant.accessToken);
  const grantToken = grant.refreshToken ?? grant.accessToken;

  if (!hasRequiredScopes(state.product, grant.scopes)) {
    // A just-minted partial grant still counts toward Google's per-account token cap, but
    // with include_granted_scopes it is the same grant any existing connection uses.
    await revokeIfUnused(svc, user.sub, grantToken);
    return fail("missing_scope");
  }

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
    const result = await linkYouTubeChannel(svc, state.contaId, clientId, connectionId, channel);
    if (result.kind === "in_use") {
      // Race backstop: another client linked the channel between the pre-check and here. The
      // connection row now exists, so the grant is in use and is NOT revoked.
      return fail("channel_in_use", result.otherName ? `&yt_other=${encodeURIComponent(result.otherName)}` : "");
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

async function linkYouTubeChannel(
  svc: DbClient,
  contaId: string,
  clientId: number,
  connectionId: string,
  channel: YouTubeChannelItem & { id: string },
): Promise<LinkResult> {
  const stats = channel.statistics ?? {};
  const { error } = await svc.from("youtube_channels").upsert(
    {
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
        return await handleCallback(svc, url);
      }
      if (req.method === "GET" && /^\/auth\/[^/]+$/.test(path)) {
        return await handleAuth(svc, req, path, url, cors);
      }
      return json(cors, { error: "not_found" }, 404);
    } catch (err) {
      console.error("[google-integration] error:", err instanceof Error ? err.message : String(err));
      return json(cors, { error: "unknown" }, 500);
    }
  };
}
