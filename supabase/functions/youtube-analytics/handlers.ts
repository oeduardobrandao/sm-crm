// supabase/functions/youtube-analytics/handlers.ts
//
// YouTube analytics read routes (spec §7, Phase 2 plan Task 10), DI'd so they run against the
// shared supabaseMock (the tiktok-analytics/handlers.ts shape). index.ts does env wiring only.
// No AI route (spec §3 / §4.6).
//
// Order on every route: tenant (google-integration/tenant.ts: profiles.active_workspace_id plus a
// workspace_members row; the legacy profiles.conta_id is never read), rate limit, input
// validation, the client loaded with conta_id = tenant (403 for a foreign client, before any plan
// flag), the two plan flags, then the channel row (404 not_connected when missing). A revoked
// channel still answers 200 with its status, so the tab shows the reconnect banner.

import { checkRateLimit as realCheckRateLimit } from "../_shared/rate-limit.ts";
import { effectivePlanFeature as realEffectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { createJsonResponder, internalServerError, type JsonResponder } from "../_shared/http.ts";
import { loadClientInTenant, resolveTenant } from "../google-integration/tenant.ts";
import { parseYtWindowRequest, type YtWindowRequest } from "../_shared/youtube-analytics/window.ts";
import type { YtContentType } from "../_shared/youtube-analytics/kpis.ts";
import {
  buildYtDaily,
  buildYtDemographics,
  buildYtOverview,
  buildYtTopShorts,
  buildYtTraffic,
  buildYtVideos,
  loadYouTubeChannel,
  YT_VIDEO_SORTS,
  type YouTubeChannelRow,
  type YtVideoSort,
} from "../_shared/youtube-analytics/queries.ts";

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

export interface YouTubeAnalyticsDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createServiceDb: () => DbClient;
  effectivePlanFeature?: FeatureCheck;
  checkRateLimit?: RateLimitCheck;
  now?: () => Date;
}

interface RouteContext {
  db: DbClient;
  json: JsonResponder;
  url: URL;
  contaId: string;
  now: Date;
  deps: YouTubeAnalyticsDeps;
}

const FEATURES = ["feature_youtube", "feature_analytics_reports"] as const;
const RATE_LIMIT = { max: 120, windowSeconds: 60 };
const CONTENT_TYPES: readonly YtContentType[] = ["all", "shorts", "long"];

/** Positive integer id from a path segment; null otherwise. */
function parseClientId(segment: string | undefined): number | null {
  if (!segment || !/^\d+$/.test(segment)) return null;
  const id = parseInt(segment, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

const badRequest = (ctx: RouteContext, error: string) => ctx.json({ error }, 400);

/** Ownership, flags, then the channel row. Any Response is the answer as is. */
async function requireChannel(ctx: RouteContext, clientId: number): Promise<YouTubeChannelRow | Response> {
  const client = await loadClientInTenant(ctx.db, clientId, ctx.contaId);
  if (!client) return ctx.json({ error: "Unauthorized" }, 403);

  const check: FeatureCheck = ctx.deps.effectivePlanFeature ?? realEffectivePlanFeature;
  for (const feature of FEATURES) {
    if (!(await check(ctx.db, ctx.contaId, feature))) return ctx.json({ error: "feature_disabled", feature }, 403);
  }

  const channel = await loadYouTubeChannel(ctx.db, ctx.contaId, clientId);
  if (!channel) return ctx.json({ error: "not_connected" }, 404);
  return channel;
}

function parseType(url: URL): YtContentType | null {
  const raw = url.searchParams.get("type") ?? "all";
  return (CONTENT_TYPES as readonly string[]).includes(raw) ? (raw as YtContentType) : null;
}

function parseSort(url: URL): YtVideoSort | null {
  const raw = url.searchParams.get("sort") ?? "views";
  return (YT_VIDEO_SORTS as readonly string[]).includes(raw) ? (raw as YtVideoSort) : null;
}

/** Validates the window (and the type, when the route takes one) before any client read. */
function windowAndType(ctx: RouteContext, withType: boolean): { req: YtWindowRequest; type: YtContentType } | Response {
  const req = parseYtWindowRequest(ctx.url.searchParams);
  if (!req) return badRequest(ctx, "invalid_window");
  const type = withType ? parseType(ctx.url) : "all";
  if (!type) return badRequest(ctx, "invalid_type");
  return { req, type };
}

// ─── Routes ─────────────────────────────────────────────────────────────────────────

async function handleOverview(ctx: RouteContext, clientId: number): Promise<Response> {
  const input = windowAndType(ctx, true);
  if (input instanceof Response) return input;
  const channel = await requireChannel(ctx, clientId);
  if (channel instanceof Response) return channel;
  return ctx.json(await buildYtOverview(ctx.db, ctx.contaId, channel, input.req, input.type, ctx.now));
}

async function handleDaily(ctx: RouteContext, clientId: number): Promise<Response> {
  const input = windowAndType(ctx, true);
  if (input instanceof Response) return input;
  const channel = await requireChannel(ctx, clientId);
  if (channel instanceof Response) return channel;
  return ctx.json({ daily: await buildYtDaily(ctx.db, ctx.contaId, channel, input.req, input.type, ctx.now) });
}

async function handleTraffic(ctx: RouteContext, clientId: number): Promise<Response> {
  const input = windowAndType(ctx, false);
  if (input instanceof Response) return input;
  const channel = await requireChannel(ctx, clientId);
  if (channel instanceof Response) return channel;
  return ctx.json({ traffic: await buildYtTraffic(ctx.db, ctx.contaId, channel, input.req, ctx.now) });
}

/** The API's own last-28-days snapshot: no window parameters. */
async function handleDemographics(ctx: RouteContext, clientId: number): Promise<Response> {
  const channel = await requireChannel(ctx, clientId);
  if (channel instanceof Response) return channel;
  return ctx.json({ rows: await buildYtDemographics(ctx.db, ctx.contaId, channel) });
}

async function handleVideos(ctx: RouteContext, clientId: number): Promise<Response> {
  const input = windowAndType(ctx, false);
  if (input instanceof Response) return input;
  const sort = parseSort(ctx.url);
  if (!sort) return badRequest(ctx, "invalid_sort");
  const channel = await requireChannel(ctx, clientId);
  if (channel instanceof Response) return channel;
  return ctx.json({ videos: await buildYtVideos(ctx.db, ctx.contaId, channel, input.req, sort, ctx.now) });
}

async function handleTopShorts(ctx: RouteContext, clientId: number): Promise<Response> {
  const input = windowAndType(ctx, false);
  if (input instanceof Response) return input;
  const channel = await requireChannel(ctx, clientId);
  if (channel instanceof Response) return channel;
  return ctx.json({ shorts: await buildYtTopShorts(ctx.db, ctx.contaId, channel, input.req, ctx.now) });
}

type ClientRoute = (ctx: RouteContext, clientId: number) => Promise<Response>;
const CLIENT_GET_ROUTES: Record<string, ClientRoute> = {
  "overview": handleOverview,
  "daily": handleDaily,
  "traffic": handleTraffic,
  "demographics": handleDemographics,
  "videos": handleVideos,
  "top-shorts": handleTopShorts,
};

async function route(req: Request, ctx: RouteContext, path: string): Promise<Response> {
  const match = path.match(/^\/([a-z-]+)\/([^/]+)$/);
  const handler = match && req.method === "GET" && Object.hasOwn(CLIENT_GET_ROUTES, match[1])
    ? CLIENT_GET_ROUTES[match[1]]
    : undefined;
  if (!match || !handler) return ctx.json({ error: "not_found" }, 404);
  const clientId = parseClientId(match[2]);
  if (clientId === null) return badRequest(ctx, "invalid_client_id");
  return await handler(ctx, clientId);
}

export function createYouTubeAnalyticsHandler(deps: YouTubeAnalyticsDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const json = createJsonResponder(cors);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/youtube-analytics(?=\/|$)/, "").replace(/\/$/, "");

    try {
      const db = deps.createServiceDb();
      const tenant = await resolveTenant(req, db, cors);
      if (tenant instanceof Response) return tenant;

      const limit: RateLimitCheck = deps.checkRateLimit ?? realCheckRateLimit;
      if (!(await limit(db, `youtube-analytics:${tenant.contaId}`, RATE_LIMIT.max, RATE_LIMIT.windowSeconds))) {
        return json({ error: "Rate limit exceeded" }, 429);
      }

      const now = (deps.now ?? (() => new Date()))();
      return await route(req, { db, json, url, contaId: tenant.contaId, now, deps }, path);
    } catch (err) {
      return internalServerError(json, "youtube-analytics", err);
    }
  };
}
