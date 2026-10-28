// supabase/functions/tiktok-analytics/handlers.ts
//
// TikTok analytics read routes, DI'd so they run against the shared supabaseMock (same
// createXHandler(deps) shape as tiktok-integration/handlers.ts). index.ts does env wiring only.
//
// Tenant identity follows report-docs, not tiktok-integration: the workspace is
// profiles.active_workspace_id confirmed by a workspace_members row, and the client's
// clientes.conta_id must equal it. The legacy profiles.conta_id is never read.

import { checkRateLimit as realCheckRateLimit } from "../_shared/rate-limit.ts";
import { effectivePlanFeature as realEffectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { createJsonResponder, internalServerError, type JsonResponder } from "../_shared/http.ts";
import { bestTimesFromPosts, tiktokRate } from "../_shared/best-times.ts";
import { type AnalyticsWindow, windowFromDays, windowFromRange } from "../_shared/tiktok-analytics/window.ts";
import { videoEngagementRate } from "../_shared/tiktok-analytics/kpis.ts";
import {
  buildOverview,
  buildPortfolio,
  loadFollowerHistory,
  loadTikTokAccount,
  loadVideosInWindow,
  type TikTokAccountRow,
} from "../_shared/tiktok-analytics/queries.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, params: Record<string, unknown>) => any;
  auth: { getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
};

// deno-lint-ignore no-explicit-any
type FeatureCheck = (db: any, workspaceId: string, featureKey: string) => Promise<boolean>;
// deno-lint-ignore no-explicit-any
type RateLimitCheck = (db: any, key: string, maxRequests: number, windowSeconds: number) => Promise<boolean>;

export interface TikTokAnalyticsDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createServiceDb: () => DbClient;
  effectivePlanFeature?: FeatureCheck;
  checkRateLimit?: RateLimitCheck;
  now?: () => Date;
  /** AI routes (Task A5). */
  fetch?: typeof fetch;
  geminiKey?: string;
}

/** Everything a route needs once the caller and workspace are known. */
export interface RouteContext {
  db: DbClient;
  json: JsonResponder;
  url: URL;
  path: string;
  userId: string;
  contaId: string;
  now: Date;
  deps: TikTokAnalyticsDeps;
}

const BASE_FEATURES = ["feature_tiktok", "feature_analytics_reports"] as const;
const RATE_LIMIT = { max: 120, windowSeconds: 60 };
const ACCOUNT_DAYS = { max: 730, fallback: 30 };
const PORTFOLIO_DAYS = { max: 365, fallback: 28 };
const BEST_TIMES_DAYS = 90;
const POSTS_CAP = 500;
const POST_SORTS = ["views", "likes", "comments", "shares", "engagement_rate", "posted_at"] as const;
type PostSort = (typeof POST_SORTS)[number];
const NOT_CONNECTED = new Set(["disconnected", "revoked"]);

/** The flag a path needs on top of feature_tiktok + feature_analytics_reports, or null. */
export function featureForTikTokPath(path: string): string | null {
  if (/^\/best-times\//.test(path)) return "feature_best_times";
  if (/^\/ai-analysis(\/|-portfolio$)/.test(path)) return "feature_instagram_ai";
  return null;
}

/** Positive integer id from a path segment; null otherwise. */
function parseClientId(segment: string | undefined): number | null {
  if (!segment || !/^\d+$/.test(segment)) return null;
  const id = parseInt(segment, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

/** `start&end` (both, valid, start <= end, span <= 730) or `days` (integer in 1..max). */
function parseWindow(url: URL, now: Date, limits: { max: number; fallback: number }, allowRange: boolean): AnalyticsWindow | null {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (start !== null || end !== null) {
    if (!allowRange || !start || !end) return null;
    return windowFromRange(start, end);
  }
  const raw = url.searchParams.get("days");
  if (raw === null) return windowFromDays(limits.fallback, now);
  if (!/^\d+$/.test(raw)) return null;
  const days = parseInt(raw, 10);
  if (isNaN(days) || days < 1 || days > limits.max) return null;
  return windowFromDays(days, now);
}

async function resolveWorkspace(ctx: { db: DbClient; json: JsonResponder; userId: string }): Promise<string | Response> {
  const { data: profile, error } = await ctx.db.from("profiles").select("active_workspace_id").eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw error;
  const contaId = profile?.active_workspace_id as string | null | undefined;
  if (!contaId) return ctx.json({ error: "Unauthorized" }, 403);
  const { data: membership, error: memberError } = await ctx.db.from("workspace_members").select("user_id")
    .eq("user_id", ctx.userId).eq("workspace_id", contaId).maybeSingle();
  if (memberError) throw memberError;
  if (!membership) return ctx.json({ error: "Unauthorized" }, 403);
  return contaId;
}

async function requireFeatures(ctx: RouteContext): Promise<Response | null> {
  const check: FeatureCheck = ctx.deps.effectivePlanFeature ?? realEffectivePlanFeature;
  const extra = featureForTikTokPath(ctx.path);
  for (const feature of extra ? [...BASE_FEATURES, extra] : BASE_FEATURES) {
    if (!(await check(ctx.db, ctx.contaId, feature))) {
      return ctx.json({ error: "feature_disabled", feature }, 403);
    }
  }
  return null;
}

async function requireOwnedClient(ctx: RouteContext, clientId: number): Promise<Response | null> {
  const { data: client, error } = await ctx.db.from("clientes").select("id, conta_id").eq("id", clientId).maybeSingle();
  if (error) throw error;
  if (!client || client.conta_id !== ctx.contaId) return ctx.json({ error: "Unauthorized" }, 403);
  return null;
}

/** Ownership, flags, then the connected account (expired still counts as connected). */
async function requireAccount(ctx: RouteContext, clientId: number): Promise<TikTokAccountRow | Response> {
  const denied = (await requireOwnedClient(ctx, clientId)) ?? (await requireFeatures(ctx));
  if (denied) return denied;
  const account = await loadTikTokAccount(ctx.db, clientId);
  if (!account || NOT_CONNECTED.has(account.authorization_status)) {
    return ctx.json({ error: "not_connected" }, 404);
  }
  return account;
}

const badRequest = (ctx: RouteContext, error: string) => ctx.json({ error }, 400);

// ─── Routes ─────────────────────────────────────────────────────────────────────────

async function handleOverview(ctx: RouteContext, clientId: number): Promise<Response> {
  const w = parseWindow(ctx.url, ctx.now, ACCOUNT_DAYS, true);
  if (!w) return badRequest(ctx, "invalid_window");
  const account = await requireAccount(ctx, clientId);
  if (account instanceof Response) return account;
  return ctx.json(await buildOverview(ctx.db, account, w, ctx.now));
}

async function handleFollowerHistory(ctx: RouteContext, clientId: number): Promise<Response> {
  const w = parseWindow(ctx.url, ctx.now, ACCOUNT_DAYS, true);
  if (!w) return badRequest(ctx, "invalid_window");
  const account = await requireAccount(ctx, clientId);
  if (account instanceof Response) return account;
  return ctx.json({ history: await loadFollowerHistory(ctx.db, account.id, w.start, w.end) });
}

function compareForSort(sort: PostSort) {
  // Descending; nulls (no views for a rate, unknown date) sort last.
  return (a: Record<string, unknown>, b: Record<string, unknown>): number => {
    const x = a[sort] as number | string | null;
    const y = b[sort] as number | string | null;
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    return x < y ? 1 : x > y ? -1 : 0;
  };
}

async function handlePostsAnalytics(ctx: RouteContext, clientId: number): Promise<Response> {
  const w = parseWindow(ctx.url, ctx.now, ACCOUNT_DAYS, true);
  if (!w) return badRequest(ctx, "invalid_window");
  const sort = (ctx.url.searchParams.get("sort") ?? "views") as PostSort;
  if (!POST_SORTS.includes(sort)) return badRequest(ctx, "invalid_sort");
  const account = await requireAccount(ctx, clientId);
  if (account instanceof Response) return account;

  const videos = await loadVideosInWindow(ctx.db, account.id, w.start, w.end);
  const posts = videos
    .map((v) => ({ ...v, engagement_rate: videoEngagementRate(v) }))
    .sort(compareForSort(sort))
    .slice(0, POSTS_CAP);
  return ctx.json({ posts });
}

async function handleBestTimes(ctx: RouteContext, clientId: number): Promise<Response> {
  const account = await requireAccount(ctx, clientId);
  if (account instanceof Response) return account;
  const w = windowFromDays(BEST_TIMES_DAYS, ctx.now);
  const videos = await loadVideosInWindow(ctx.db, account.id, w.start, w.end);
  const posts = videos
    .filter((v): v is typeof v & { posted_at: string } => !!v.posted_at)
    .map((v) => ({ posted_at: v.posted_at, likes: v.likes, comments: v.comments, shares: v.shares, views: v.views }));
  return ctx.json(bestTimesFromPosts(posts, tiktokRate));
}

async function handlePortfolio(ctx: RouteContext): Promise<Response> {
  const w = parseWindow(ctx.url, ctx.now, PORTFOLIO_DAYS, false);
  if (!w) return badRequest(ctx, "invalid_window");
  const denied = await requireFeatures(ctx);
  if (denied) return denied;
  return ctx.json(await buildPortfolio(ctx.db, ctx.contaId, w, ctx.now));
}

type ClientRoute = (ctx: RouteContext, clientId: number) => Promise<Response>;
const CLIENT_GET_ROUTES: Record<string, ClientRoute> = {
  "overview": handleOverview,
  "follower-history": handleFollowerHistory,
  "posts-analytics": handlePostsAnalytics,
  "best-times": handleBestTimes,
};

async function route(req: Request, ctx: RouteContext): Promise<Response> {
  if (req.method === "GET" && ctx.path === "/portfolio") return await handlePortfolio(ctx);

  const match = ctx.path.match(/^\/([a-z-]+)\/([^/]+)$/);
  const handler = match && req.method === "GET" ? CLIENT_GET_ROUTES[match[1]] : undefined;
  if (match && handler) {
    const clientId = parseClientId(match[2]);
    if (clientId === null) return badRequest(ctx, "invalid_client_id");
    return await handler(ctx, clientId);
  }
  return ctx.json({ error: "not_found" }, 404);
}

export function createTikTokAnalyticsHandler(deps: TikTokAnalyticsDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const json = createJsonResponder(cors);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/tiktok-analytics(?=\/|$)/, "").replace(/\/$/, "");

    try {
      const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
      if (!token || token === "undefined" || token === "null") return json({ error: "Unauthorized" }, 401);
      const db = deps.createServiceDb();
      const { data: { user }, error } = await db.auth.getUser(token);
      if (error || !user) return json({ error: "Unauthorized" }, 401);

      const contaId = await resolveWorkspace({ db, json, userId: user.id });
      if (contaId instanceof Response) return contaId;

      const limit: RateLimitCheck = deps.checkRateLimit ?? realCheckRateLimit;
      if (!(await limit(db, `tiktok-analytics:${contaId}`, RATE_LIMIT.max, RATE_LIMIT.windowSeconds))) {
        return json({ error: "Rate limit exceeded" }, 429);
      }

      const now = (deps.now ?? (() => new Date()))();
      return await route(req, { db, json, url, path, userId: user.id, contaId, now, deps });
    } catch (err) {
      return internalServerError(json, "tiktok-analytics", err);
    }
  };
}
