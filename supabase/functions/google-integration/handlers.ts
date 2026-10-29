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

  if (!hasRequiredScopes(state.product, grant.scopes)) {
    // A just-minted partial grant still counts toward Google's per-account token cap.
    await revokeGoogleToken(grant.refreshToken ?? grant.accessToken);
    return fail("missing_scope");
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
  if (state.product === "youtube") {
    const result = await linkYouTubeChannel(svc, state.contaId, clientId, connectionId, grant.accessToken);
    if (result.kind === "no_channel") return fail("no_channel");
    if (result.kind === "in_use") {
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

type LinkResult = { kind: "linked" } | { kind: "no_channel" } | { kind: "in_use"; otherName: string | null };

async function linkYouTubeChannel(
  svc: DbClient,
  contaId: string,
  clientId: number,
  connectionId: string,
  accessToken: string,
): Promise<LinkResult> {
  const body = (await googleFetch(YOUTUBE_CHANNELS_URL, accessToken)) as { items?: YouTubeChannelItem[] } | null;
  const channel = body?.items?.[0];
  if (!channel?.id) return { kind: "no_channel" };

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
      if (req.method === "GET" && path.startsWith("/auth/")) {
        return await handleAuth(svc, req, path, url, cors);
      }
      return json(cors, { error: "not_found" }, 404);
    } catch (err) {
      console.error("[google-integration] error:", err instanceof Error ? err.message : String(err));
      return json(cors, { error: "unknown" }, 500);
    }
  };
}
