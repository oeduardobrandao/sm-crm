// supabase/functions/tiktok-integration/handlers.ts
//
// Route handlers for the TikTok connect/sync/disconnect surface, DI'd so they're testable
// without a live Supabase project (mirrors instagram-publish/handler.ts's createXHandler(deps)
// pattern). index.ts does env wiring only; this file owns routing + business logic. TikTok API
// calls go through the global `fetch` (matching _shared/tiktok.ts's own convention — tests
// stub `globalThis.fetch`, same as tiktok-shared_test.ts / tiktok-token-refresh_test.ts).

import { insertAuditLog } from "../_shared/audit.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import {
  TIKTOK_AUTH_URL,
  TIKTOK_API_BASE,
  TIKTOK_SCOPES,
  encryptTikTokToken,
  decryptTikTokToken,
  tiktokFetch,
  TikTokApiError,
  getFreshTikTokToken,
  requireTikTokClientCredentials,
} from "../_shared/tiktok.ts";
import { createSignedState, verifySignedState } from "./oauth-state.ts";
import { importTikTokVideos, cacheTikTokAvatar, type ThumbnailStorage } from "./import.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> | {
    single: () => Promise<{ data: unknown; error: unknown }>;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  };
  auth: { getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  storage: ThumbnailStorage;
};

export interface TikTokIntegrationDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createServiceDb: () => DbClient;
}

const PROFILE_FIELDS =
  "open_id,union_id,avatar_url,display_name,username,profile_deep_link,follower_count,following_count,likes_count,video_count";

function json(cors: Record<string, string>, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function isValidClientId(clientId: string | undefined): clientId is string {
  return !!clientId && /^\d+$/.test(clientId);
}

function oauthRedirectBase(): string {
  return Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:3000";
}

/** Canonical redirect_uri: the value registered in the TikTok developer portal, falling
 * back to deriving one from the incoming request (mirrors instagram-integration's
 * META_REDIRECT_URI-or-derived pattern). */
function resolveFunctionBaseUrl(req: Request): string {
  const url = new URL(req.url);
  const origin = url.origin.replace(/^http:\/\//, "https://");
  return Deno.env.get("TIKTOK_REDIRECT_URI") || `${origin}/functions/v1/tiktok-integration`;
}

// ─── Auth / ownership guards — return a Response directly on failure (not throw), so
// callers can `if (result instanceof Response) return result;` exactly like the success
// paths they gate. Genuinely unexpected failures (network/DB errors) still throw and are
// handled by the outer try/catch in createTikTokIntegrationHandler. ──────────────────────

async function requireUser(
  req: Request,
  svc: DbClient,
  cors: Record<string, string>,
): Promise<{ id: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || token === "undefined" || token === "null") {
    return json(cors, { error: true, message: "Não autorizado" }, 401);
  }
  const { data: { user }, error } = await svc.auth.getUser(token);
  if (error || !user) {
    return json(cors, { error: true, message: "Não autorizado" }, 401);
  }
  return user;
}

async function verifyClientOwnership(svc: DbClient, clientId: string, contaId: string): Promise<boolean> {
  const { data: client } = await svc.from("clientes").select("conta_id").eq("id", parseInt(clientId, 10)).single();
  return client?.conta_id === contaId;
}

/** Same 403 shape/body as instagram-integration's inline ownership check (test parity). */
async function requireOwnership(
  svc: DbClient,
  clientId: string,
  userId: string,
  cors: Record<string, string>,
): Promise<string | Response> {
  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", userId).single();
  if (!profile?.conta_id || !(await verifyClientOwnership(svc, clientId, profile.conta_id))) {
    return json(cors, { error: true, message: "Unauthorized" }, 403);
  }
  return profile.conta_id as string;
}

// ─── GET /auth/:clientId ──────────────────────────────────────────────────────────────

async function handleAuth(
  svc: DbClient,
  path: string,
  user: { id: string },
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const clientId = path.split("/")[2];
  if (!isValidClientId(clientId)) return json(cors, { error: true, message: "Client ID required" }, 400);

  const ownership = await requireOwnership(svc, clientId, user.id, cors);
  if (ownership instanceof Response) return ownership;
  const contaId = ownership;

  if (!(await effectivePlanFeature(svc as any, contaId, "feature_tiktok"))) {
    return json(cors, { error: "feature_disabled", feature: "feature_tiktok" }, 403);
  }

  const { clientKey } = requireTikTokClientCredentials();
  const redirectUri = resolveFunctionBaseUrl(req);
  const state = await createSignedState(clientId, user.id, contaId, svc);
  const authorizeUrl =
    `${TIKTOK_AUTH_URL}?client_key=${clientKey}&scope=${TIKTOK_SCOPES}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  return json(cors, { url: authorizeUrl });
}

// ─── GET /callback (public — no JWT) ──────────────────────────────────────────────────

async function handleCallback(svc: DbClient, url: URL, req: Request): Promise<Response> {
  const code = url.searchParams.get("code")?.replace(/#_$/, "");
  const state = url.searchParams.get("state");
  if (!code) throw new Error("Missing auth code");

  const { clientId, nonce, contaId, userId } = await verifySignedState(state || "");
  if (!clientId || !/^\d+$/.test(String(clientId))) throw new Error("Invalid client ID in state parameter");

  const { data: oauthState, error: nonceErr } = await svc
    .from("oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("nonce", nonce)
    .eq("provider", "tiktok")
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select()
    .single();
  if (nonceErr || !oauthState) throw new Error("OAuth state expired or already used");

  const { clientKey, clientSecret } = requireTikTokClientCredentials();
  const redirectUri = resolveFunctionBaseUrl(req);

  const tokenRes = await fetch(`${TIKTOK_API_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new Error(tokenData.error_description || tokenData.error);
  }
  const { open_id, access_token, expires_in, refresh_token, refresh_expires_in, scope } = tokenData;
  if (!open_id || !access_token) throw new Error("TikTok did not return an access token");

  const profileResult = (await tiktokFetch(`/user/info/?fields=${PROFILE_FIELDS}`, {
    accessToken: access_token,
  })) as { user?: Record<string, unknown> };
  // deno-lint-ignore no-explicit-any
  const profile = (profileResult.user ?? {}) as Record<string, any>;

  const [encryptedAccess, encryptedRefresh] = await Promise.all([
    encryptTikTokToken(access_token, "access"),
    encryptTikTokToken(refresh_token, "refresh"),
  ]);
  const now = Date.now();
  const accessTokenExpiresAt = new Date(now + (expires_in ?? 0) * 1000).toISOString();
  const refreshTokenExpiresAt = new Date(now + (refresh_expires_in ?? 0) * 1000).toISOString();

  // TikTok avatar_url is also a short-lived signed CDN link — cache it up front (keyed by
  // client_id, which is stable and known before the account row exists) rather than waiting
  // for the first /sync, unlike instagram-integration which only caches on sync.
  const cachedAvatar = await cacheTikTokAvatar(fetch, svc.storage, clientId, (profile.avatar_url as string) ?? null);

  const { data: upserted, error: upsertErr } = await svc
    .from("tiktok_accounts")
    .upsert({
      client_id: clientId,
      tiktok_open_id: open_id,
      username: profile.username ?? "",
      display_name: profile.display_name ?? "",
      avatar_url: cachedAvatar ?? profile.avatar_url ?? null,
      profile_deep_link: profile.profile_deep_link ?? null,
      follower_count: profile.follower_count ?? null,
      following_count: profile.following_count ?? null,
      likes_count: profile.likes_count ?? null,
      video_count: profile.video_count ?? null,
      encrypted_access_token: encryptedAccess,
      encrypted_refresh_token: encryptedRefresh,
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      scopes: String(scope ?? "").split(",").filter(Boolean),
      authorization_status: "active",
      last_synced_at: new Date().toISOString(),
    }, { onConflict: "client_id" })
    .select("id")
    .single();
  if (upsertErr || !upserted) {
    throw new Error(upsertErr && typeof upsertErr === "object" && "message" in upsertErr
      ? String((upsertErr as { message?: string }).message)
      : "Failed to save TikTok account");
  }

  // deno-lint-ignore no-explicit-any
  const accountId = (upserted as any).id as string;

  await insertAuditLog(svc, {
    conta_id: contaId,
    actor_user_id: userId,
    action: "tiktok-link",
    resource_type: "tiktok_account",
    resource_id: String(clientId),
    metadata: { tiktok_username: profile.username ?? "", tiktok_open_id: open_id },
  });

  // Follower snapshot + initial import are best-effort: connecting the account must succeed
  // even if these secondary calls fail (mirrors instagram-integration's callback).
  try {
    const today = new Date().toISOString().split("T")[0];
    const { data: existingEntry } = await svc
      .from("tiktok_follower_history")
      .select("source")
      .eq("tiktok_account_id", accountId)
      .eq("date", today)
      .maybeSingle();
    if (!existingEntry || (existingEntry as { source?: string }).source !== "manual") {
      await svc.from("tiktok_follower_history").upsert({
        tiktok_account_id: accountId,
        date: today,
        follower_count: profile.follower_count ?? 0,
        source: "api",
      }, { onConflict: "tiktok_account_id,date" });
    }

    await importTikTokVideos({ fetch, storage: svc.storage }, svc, accountId, access_token, { maxVideos: 100 });
  } catch (e) {
    console.error("[tiktok-integration] callback: history/import best-effort failed:", (e as Error)?.message);
  }

  return Response.redirect(`${oauthRedirectBase()}/clientes/${clientId}`, 302);
}

// ─── POST /sync/:clientId ─────────────────────────────────────────────────────────────

async function handleSync(
  svc: DbClient,
  path: string,
  user: { id: string },
  cors: Record<string, string>,
): Promise<Response> {
  const clientId = path.split("/")[2];
  if (!isValidClientId(clientId)) return json(cors, { error: true, message: "Invalid client ID" }, 400);

  const ownership = await requireOwnership(svc, clientId, user.id, cors);
  if (ownership instanceof Response) return ownership;
  const contaId = ownership;

  if (!(await effectivePlanFeature(svc as any, contaId, "feature_tiktok"))) {
    return json(cors, { error: "feature_disabled", feature: "feature_tiktok" }, 403);
  }

  const allowed = await checkRateLimit(svc as any, `tiktok-sync:${contaId}:${clientId}`, 5, 300);
  if (!allowed) return json(cors, { error: "Rate limit exceeded" }, 429);

  // deno-lint-ignore no-explicit-any
  const { data: account } = await svc.from("tiktok_accounts").select("*").eq("client_id", clientId).maybeSingle() as { data: any };
  if (!account) return json(cors, { error: true, message: "Conta TikTok não encontrada" }, 404);
  if (account.authorization_status === "disconnected" || account.authorization_status === "revoked") {
    const code = account.authorization_status === "revoked" ? "ACCOUNT_REVOKED" : "ACCOUNT_DISCONNECTED";
    return json(cors, { error: true, code, message: "Conta TikTok não está ativa" }, 400);
  }

  let accessToken: string;
  try {
    ({ accessToken } = await getFreshTikTokToken(svc as any, account.id));
  } catch (e) {
    if (e instanceof TikTokApiError && e.code === "TOKEN_EXPIRED") {
      return json(cors, { error: true, code: "TOKEN_EXPIRED", message: "Token TikTok expirado" }, 401);
    }
    throw e;
  }

  const profileResult = (await tiktokFetch(`/user/info/?fields=${PROFILE_FIELDS}`, {
    accessToken,
  })) as { user?: Record<string, unknown> };
  // deno-lint-ignore no-explicit-any
  const profile = (profileResult.user ?? {}) as Record<string, any>;

  const cachedAvatar = await cacheTikTokAvatar(fetch, svc.storage, clientId, (profile.avatar_url as string) ?? null);

  const today = new Date().toISOString().split("T")[0];
  const { data: existingEntry } = await svc
    .from("tiktok_follower_history")
    .select("source")
    .eq("tiktok_account_id", account.id)
    .eq("date", today)
    .maybeSingle();
  const shouldUpsertHistory = !existingEntry || (existingEntry as { source?: string }).source !== "manual";

  const { error: accountUpdateErr } = await svc.from("tiktok_accounts").update({
    username: profile.username ?? account.username,
    display_name: profile.display_name ?? account.display_name,
    avatar_url: cachedAvatar ?? account.avatar_url,
    follower_count: profile.follower_count ?? account.follower_count,
    following_count: profile.following_count ?? account.following_count,
    likes_count: profile.likes_count ?? account.likes_count,
    video_count: profile.video_count ?? account.video_count,
    last_synced_at: new Date().toISOString(),
  }).eq("id", account.id);
  if (accountUpdateErr) {
    console.error("[tiktok-integration] sync: account update failed:", (accountUpdateErr as { message?: string }).message);
  }

  if (shouldUpsertHistory) {
    const { error: historyErr } = await svc.from("tiktok_follower_history").upsert({
      tiktok_account_id: account.id,
      date: today,
      follower_count: profile.follower_count ?? account.follower_count ?? 0,
      source: "api",
    }, { onConflict: "tiktok_account_id,date" });
    if (historyErr) {
      console.error("[tiktok-integration] sync: follower_history upsert failed:", (historyErr as { message?: string }).message);
    }
  }

  const syncedPosts = await importTikTokVideos({ fetch, storage: svc.storage }, svc, account.id, accessToken, {
    maxVideos: 100,
  });

  return json(cors, { ok: true, synced_posts: syncedPosts });
}

// ─── POST /refresh/:clientId ──────────────────────────────────────────────────────────

async function handleRefresh(
  svc: DbClient,
  path: string,
  user: { id: string },
  cors: Record<string, string>,
): Promise<Response> {
  const clientId = path.split("/")[2];
  if (!isValidClientId(clientId)) return json(cors, { error: true, message: "Invalid client ID" }, 400);

  const ownership = await requireOwnership(svc, clientId, user.id, cors);
  if (ownership instanceof Response) return ownership;

  // deno-lint-ignore no-explicit-any
  const { data: account } = await svc.from("tiktok_accounts").select("id").eq("client_id", clientId).maybeSingle() as { data: any };
  if (!account) return json(cors, { error: true, message: "Conta TikTok não encontrada" }, 404);

  try {
    await getFreshTikTokToken(svc as any, account.id);
  } catch (e) {
    if (e instanceof TikTokApiError && e.code === "TOKEN_EXPIRED") {
      return json(cors, { error: true, code: "TOKEN_EXPIRED", message: "Token expirado — necessário reconectar" }, 401);
    }
    return json(cors, { error: true, code: "REFRESH_FAILED", message: "Falha ao atualizar token" }, 400);
  }

  return json(cors, { ok: true });
}

// ─── POST | DELETE /disconnect/:clientId ──────────────────────────────────────────────

async function handleDisconnect(
  svc: DbClient,
  path: string,
  user: { id: string },
  cors: Record<string, string>,
): Promise<Response> {
  const clientId = path.split("/")[2];
  if (!isValidClientId(clientId)) return json(cors, { error: true, message: "Invalid client ID" }, 400);

  const ownership = await requireOwnership(svc, clientId, user.id, cors);
  if (ownership instanceof Response) return ownership;

  const { data: account } = await svc
    .from("tiktok_accounts")
    .select("id, encrypted_access_token")
    .eq("client_id", clientId)
    .maybeSingle() as { data: { id: string; encrypted_access_token: string | null } | null };

  if (account) {
    if (account.encrypted_access_token) {
      try {
        const accessToken = await decryptTikTokToken(account.encrypted_access_token, "access");
        const { clientKey, clientSecret } = requireTikTokClientCredentials();
        await fetch(`${TIKTOK_API_BASE}/oauth/revoke/`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, token: accessToken }),
        });
      } catch (e) {
        // Revocation is best-effort — TikTok being unreachable must not block the local
        // disconnect (mirrors instagram-integration, which has no external revoke call at all).
        console.error("[tiktok-integration] revoke call failed (non-fatal):", (e as Error)?.message);
      }
    }

    await svc.from("tiktok_posts").delete().eq("tiktok_account_id", account.id);

    const { error: updateErr } = await svc.from("tiktok_accounts").update({
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      access_token_expires_at: null,
      refresh_token_expires_at: null,
      authorization_status: "disconnected",
      last_synced_at: null,
    }).eq("id", account.id);
    if (updateErr) {
      throw new Error(
        typeof updateErr === "object" && updateErr && "message" in updateErr
          ? String((updateErr as { message?: string }).message)
          : "Failed to disconnect TikTok account",
      );
    }
  }

  return json(cors, { ok: true });
}

// ─── GET /summary/:clientId ───────────────────────────────────────────────────────────

async function handleSummary(
  svc: DbClient,
  path: string,
  user: { id: string },
  cors: Record<string, string>,
): Promise<Response> {
  const clientId = path.split("/")[2];
  if (!isValidClientId(clientId)) return json(cors, { error: true, message: "Invalid client ID" }, 400);

  const ownership = await requireOwnership(svc, clientId, user.id, cors);
  if (ownership instanceof Response) return ownership;

  const SUMMARY_FIELDS =
    "id,client_id,tiktok_open_id,username,display_name,avatar_url,profile_deep_link,follower_count,following_count,likes_count,video_count,access_token_expires_at,refresh_token_expires_at,last_synced_at,created_at,authorization_status,scopes,auto_sync_enabled";
  const { data, error } = await svc
    .from("tiktok_accounts")
    .select(SUMMARY_FIELDS)
    .eq("client_id", clientId)
    .maybeSingle() as { data: { id: string; authorization_status: string } | null; error: unknown };

  if (error || !data || data.authorization_status === "disconnected") {
    return json(cors, { exists: false });
  }

  const { data: history } = await svc
    .from("tiktok_follower_history")
    .select("*")
    .eq("tiktok_account_id", data.id)
    .order("date", { ascending: false })
    .limit(30) as { data: unknown[] | null };

  return json(cors, { account: data, follower_history: (history ?? []).reverse() });
}

// ─── GET /posts/:clientId?page= ───────────────────────────────────────────────────────

async function handlePosts(
  svc: DbClient,
  path: string,
  user: { id: string },
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const clientId = path.split("/")[2];
  if (!isValidClientId(clientId)) return json(cors, { error: true, message: "Invalid client ID" }, 400);

  const ownership = await requireOwnership(svc, clientId, user.id, cors);
  if (ownership instanceof Response) return ownership;

  const pageStr = url.searchParams.get("page") || "1";
  const page = Math.max(1, parseInt(pageStr) || 1);
  const limit = 10;
  const offset = (page - 1) * limit;

  const { data: account } = await svc.from("tiktok_accounts").select("id").eq("client_id", clientId).maybeSingle() as {
    data: { id: string } | null;
  };
  if (!account) return json(cors, { error: true, message: "Not found" }, 404);

  const { data, error, count } = await svc
    .from("tiktok_posts")
    .select("*", { count: "exact" })
    .eq("tiktok_account_id", account.id)
    .order("posted_at", { ascending: false })
    .range(offset, offset + limit - 1) as { data: unknown[] | null; error: { message?: string } | null; count: number | null };

  if (error) throw new Error(error.message ?? "Failed to load TikTok posts");
  return json(cors, { posts: data, total: count });
}

// ─── Error mapping (unexpected throws only — guard-clause Responses above are final) ──

async function handleUnexpectedError(
  err: unknown,
  isCallback: boolean,
  url: URL,
  cors: Record<string, string>,
): Promise<Response> {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[tiktok-integration] error:", message);

  if (isCallback) {
    const stateParam = url.searchParams.get("state");
    let clientId: string | undefined;
    try {
      clientId = (await verifySignedState(stateParam || "")).clientId;
    } catch { /* signature/format invalid — fall back to the base redirect below */ }
    const base = oauthRedirectBase();
    const target = clientId ? `${base}/clientes/${clientId}?tt_error=1` : `${base}?tt_error=1`;
    return Response.redirect(target, 302);
  }

  const isTokenExpired = message.includes("expired");
  return json(cors, {
    error: true,
    message: isTokenExpired ? "Token expirado" : "Erro interno",
    code: isTokenExpired ? "TOKEN_EXPIRED" : undefined,
  }, isTokenExpired ? 401 : 400);
}

// ─── Dispatch ──────────────────────────────────────────────────────────────────────────

export function createTikTokIntegrationHandler(deps: TikTokIntegrationDeps) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname.replace("/tiktok-integration", "").replace(/\/$/, "");
    const cors = deps.buildCorsHeaders(req);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const svc = deps.createServiceDb();
    const isCallback = path === "/callback" || (path === "" && url.searchParams.has("code"));

    try {
      let user: { id: string } | undefined;
      if (!isCallback) {
        const authResult = await requireUser(req, svc, cors);
        if (authResult instanceof Response) return authResult;
        user = authResult;
      }

      if (req.method === "GET" && path.startsWith("/auth/")) {
        return await handleAuth(svc, path, user!, req, cors);
      }
      if (req.method === "GET" && isCallback) {
        return await handleCallback(svc, url, req);
      }
      if (req.method === "POST" && path.startsWith("/sync/")) {
        return await handleSync(svc, path, user!, cors);
      }
      if (req.method === "POST" && path.startsWith("/refresh/")) {
        return await handleRefresh(svc, path, user!, cors);
      }
      if ((req.method === "POST" || req.method === "DELETE") && path.startsWith("/disconnect/")) {
        return await handleDisconnect(svc, path, user!, cors);
      }
      if (req.method === "GET" && path.startsWith("/summary/")) {
        return await handleSummary(svc, path, user!, cors);
      }
      if (req.method === "GET" && path.startsWith("/posts/")) {
        return await handlePosts(svc, path, user!, url, cors);
      }

      return json(cors, { error: true, message: `Not Found - method: ${req.method}, path: "${path}"` }, 404);
    } catch (err) {
      return await handleUnexpectedError(err, isCallback, url, cors);
    }
  };
}
