// supabase/functions/gbp-analytics/handlers.ts
//
// Google Meu Negócio analytics read routes (spec §7, Phase 2 Task 11), DI'd so they run against the
// shared supabaseMock (same createXHandler(deps) shape as tiktok-analytics). index.ts does env
// wiring only. No AI route.
//
// Guard order: tenant (google-integration/tenant.ts: active_workspace_id + workspace_members,
// never profiles.conta_id) -> rate limit -> query syntax (400) -> the client with conta_id =
// tenant (403) -> plan flags -> the client's counted units (404 not_connected).

import { checkRateLimit as realCheckRateLimit } from "../_shared/rate-limit.ts";
import { effectivePlanFeature as realEffectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { createJsonResponder, internalServerError, type JsonResponder } from "../_shared/http.ts";
import { resolveTenant } from "../google-integration/tenant.ts";
import { parseWindowRequest, type WindowRequest } from "../_shared/gbp-analytics/window.ts";
import {
  buildDaily,
  buildKeywords,
  buildOverview,
  buildRatingDistribution,
  buildReviews,
  buildSurfaces,
  buildUnits,
  currentMonthStart,
  GBP_REVIEW_FILTERS,
  type GbpReviewFilter,
  type GbpUnit,
  loadUnits,
} from "../_shared/gbp-analytics/queries.ts";

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

export interface GbpAnalyticsDeps {
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
  deps: GbpAnalyticsDeps;
}

const FEATURES = ["feature_google_business", "feature_analytics_reports"] as const;
const RATE_LIMIT = { max: 120, windowSeconds: 60 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Positive integer id from a path segment; null otherwise. */
function parseClientId(segment: string): number | null {
  if (!/^\d+$/.test(segment)) return null;
  const id = parseInt(segment, 10);
  return isNaN(id) || id <= 0 ? null : id;
}

/** `all` (also when absent) or a unit uuid; null when malformed. */
function parseLocation(url: URL): string | null {
  const raw = url.searchParams.get("location");
  if (raw === null || raw === "all") return "all";
  return UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

const badRequest = (ctx: RouteContext, error: string) => ctx.json({ error }, 400);
const notConnected = (ctx: RouteContext) => ctx.json({ error: "not_connected" }, 404);

async function requireOwnedClient(ctx: RouteContext, clientId: number): Promise<Response | null> {
  const { data: client, error } = await ctx.db.from("clientes").select("id, conta_id")
    .eq("id", clientId)
    .eq("conta_id", ctx.contaId)
    .maybeSingle();
  if (error) throw error;
  if (!client || client.conta_id !== ctx.contaId) return ctx.json({ error: "Unauthorized" }, 403);
  return null;
}

async function requireFeatures(ctx: RouteContext): Promise<Response | null> {
  const check: FeatureCheck = ctx.deps.effectivePlanFeature ?? realEffectivePlanFeature;
  for (const feature of FEATURES) {
    if (!(await check(ctx.db, ctx.contaId, feature))) return ctx.json({ error: "feature_disabled", feature }, 403);
  }
  return null;
}

/** Ownership, flags, then the units the request selects: every counted unit for `all`, else the
 * one with that id. No counted unit, or an id that is not one of them, is 404 not_connected. */
async function requireUnits(ctx: RouteContext, clientId: number, location: string): Promise<GbpUnit[] | Response> {
  const denied = (await requireOwnedClient(ctx, clientId)) ?? (await requireFeatures(ctx));
  if (denied) return denied;
  const units = await loadUnits(ctx.db, ctx.contaId, clientId);
  if (units.length === 0) return notConnected(ctx);
  if (location === "all") return units;
  const unit = units.find((u) => u.id.toLowerCase() === location);
  return unit ? [unit] : notConnected(ctx);
}

// ─── Routes ─────────────────────────────────────────────────────────────────────────

type ClientRoute = (ctx: RouteContext, clientId: number) => Promise<Response>;

/** The window routes share their parsing: window syntax, then location. */
function windowRoute(
  run: (ctx: RouteContext, units: GbpUnit[], req: WindowRequest) => Promise<unknown>,
  { allUnits = false }: { allUnits?: boolean } = {},
): ClientRoute {
  return async (ctx, clientId) => {
    const req = parseWindowRequest(ctx.url.searchParams);
    if (!req) return badRequest(ctx, "invalid_window");
    const location = allUnits ? "all" : parseLocation(ctx.url);
    if (location === null) return badRequest(ctx, "invalid_location");
    const units = await requireUnits(ctx, clientId, location);
    if (units instanceof Response) return units;
    return ctx.json(await run(ctx, units, req));
  };
}

const handleOverview = windowRoute((ctx, units, req) => buildOverview(ctx.db, ctx.contaId, units, req, ctx.now));
const handleDaily = windowRoute(async (ctx, units, req) => ({
  daily: await buildDaily(ctx.db, ctx.contaId, units, req, ctx.now),
}));
const handleSurfaces = windowRoute(async (ctx, units, req) => ({
  surfaces: await buildSurfaces(ctx.db, ctx.contaId, units, req, ctx.now),
}));
// The units table always compares every counted unit; `location` does not narrow it.
const handleUnits = windowRoute(
  async (ctx, units, req) => ({ units: await buildUnits(ctx.db, ctx.contaId, units, req, ctx.now) }),
  { allUnits: true },
);

async function handleKeywords(ctx: RouteContext, clientId: number): Promise<Response> {
  const month = ctx.url.searchParams.get("month");
  // Closed months only: the current SP month is still being counted.
  if (month !== null && (!MONTH_RE.test(month) || `${month}-01` >= currentMonthStart(ctx.now))) {
    return badRequest(ctx, "invalid_month");
  }
  const location = parseLocation(ctx.url);
  if (location === null) return badRequest(ctx, "invalid_location");
  const units = await requireUnits(ctx, clientId, location);
  if (units instanceof Response) return units;
  return ctx.json(await buildKeywords(ctx.db, ctx.contaId, units, month, ctx.now));
}

async function handleReviews(ctx: RouteContext, clientId: number): Promise<Response> {
  const filter = (ctx.url.searchParams.get("filter") ?? "all") as GbpReviewFilter;
  if (!GBP_REVIEW_FILTERS.includes(filter)) return badRequest(ctx, "invalid_filter");
  const location = parseLocation(ctx.url);
  if (location === null) return badRequest(ctx, "invalid_location");
  const units = await requireUnits(ctx, clientId, location);
  if (units instanceof Response) return units;
  return ctx.json({ reviews: await buildReviews(ctx.db, ctx.contaId, units, filter) });
}

async function handleRatingDistribution(ctx: RouteContext, clientId: number): Promise<Response> {
  const location = parseLocation(ctx.url);
  if (location === null) return badRequest(ctx, "invalid_location");
  const units = await requireUnits(ctx, clientId, location);
  if (units instanceof Response) return units;
  return ctx.json(await buildRatingDistribution(ctx.db, ctx.contaId, units));
}

const CLIENT_GET_ROUTES: Record<string, ClientRoute> = {
  "overview": handleOverview,
  "daily": handleDaily,
  "surfaces": handleSurfaces,
  "keywords": handleKeywords,
  "reviews": handleReviews,
  "rating-distribution": handleRatingDistribution,
  "units": handleUnits,
};

async function route(req: Request, ctx: RouteContext, path: string): Promise<Response> {
  const match = req.method === "GET" ? path.match(/^\/([a-z-]+)\/([^/]+)$/) : null;
  const handler = match && Object.hasOwn(CLIENT_GET_ROUTES, match[1]) ? CLIENT_GET_ROUTES[match[1]] : undefined;
  if (!match || !handler) return ctx.json({ error: "not_found" }, 404);
  const clientId = parseClientId(match[2]);
  if (clientId === null) return badRequest(ctx, "invalid_client_id");
  return await handler(ctx, clientId);
}

export function createGbpAnalyticsHandler(deps: GbpAnalyticsDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const json = createJsonResponder(cors);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*\/gbp-analytics(?=\/|$)/, "").replace(/\/$/, "");

    try {
      const db = deps.createServiceDb();
      const tenant = await resolveTenant(req, db, cors);
      if (tenant instanceof Response) return tenant;

      const limit: RateLimitCheck = deps.checkRateLimit ?? realCheckRateLimit;
      if (!(await limit(db, `gbp-analytics:${tenant.contaId}`, RATE_LIMIT.max, RATE_LIMIT.windowSeconds))) {
        return json({ error: "Rate limit exceeded" }, 429);
      }

      const now = (deps.now ?? (() => new Date()))();
      return await route(req, { db, json, url, contaId: tenant.contaId, now, deps }, path);
    } catch (err) {
      return internalServerError(json, "gbp-analytics", err);
    }
  };
}
