// Shared Instagram per-post metric helpers, used by every sync site
// (instagram-integration connect + refresh, instagram-sync-cron). Pure /
// fetch-injectable so the preservation + availability logic is unit-tested.
//
// Three insights requests per post, run concurrently and isolated from each
// other: a failure in one never removes values another returned.
//   1. core:    reach,views,saved,shares (retried without shares)
//   2. actions: reposts,follows,profile_visits (retried with reposts alone on a
//               non-transient error; Meta documents follows/profile_visits for
//               FEED and STORY only)
//   3. bio:     profile_activity&breakdown=action_type -> bio_link_clicked. Its
//               own request: Meta errors when a breakdown is mixed with metrics
//               that don't support it.

type InsightValue = {
  reach?: number;
  impressions?: number;
  saved?: number;
  shares?: number;
  reposts?: number;
  profile_visits?: number;
  follows?: number;
  bio_link_clicks?: number;
};
type ApiToken = "reach" | "views" | "saved" | "shares" | "reposts" | "follows" | "profile_visits";
// API metric name -> our column token. `views` is stored as `impressions`.
const API_TO_COL: Record<ApiToken, keyof InsightValue> = {
  reach: "reach",
  views: "impressions",
  saved: "saved",
  shares: "shares",
  reposts: "reposts",
  follows: "follows",
  profile_visits: "profile_visits",
};

// The edge runtime kills isolates that hang on I/O; bound every request.
const INSIGHT_TIMEOUT_MS = 10_000;
// Graph error codes that mean "try later" (throttling, temporary) or "bad
// token". Retrying with fewer metrics can't fix these.
const TRANSIENT_OR_AUTH_CODES = new Set([1, 2, 4, 9, 17, 32, 613, 190]);

function metricNumber(insight: any): number | undefined {
  const v = insight?.values?.[0]?.value;
  if (typeof v === "number") return v;
  const t = insight?.total_value?.value;
  return typeof t === "number" ? t : undefined;
}

function parseInto(data: any[], values: InsightValue, returned: Set<string>): void {
  for (const insight of data ?? []) {
    const col = API_TO_COL[insight?.name as ApiToken];
    const v = metricNumber(insight);
    if (col && typeof v === "number") {
      values[col] = v;
      returned.add(col);
    }
  }
}

/**
 * Bio link taps from a `profile_activity` + `breakdown=action_type` response.
 * A valid response without a bio_link_clicked result means 0 taps; a missing
 * or malformed `total_value` means absent (undefined).
 */
export function parseBioLinkClicks(data: unknown): number | undefined {
  if (!Array.isArray(data)) return undefined;
  const insight = data.find((i: any) => i?.name === "profile_activity");
  const total = insight?.total_value;
  if (!total || typeof total !== "object") return undefined;
  const results = total.breakdowns?.[0]?.results;
  if (!Array.isArray(results)) return 0;
  const hit = results.find(
    (r: any) => String(r?.dimension_values?.[0] ?? "").toLowerCase() === "bio_link_clicked",
  );
  return typeof hit?.value === "number" ? hit.value : 0;
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<any> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(INSIGHT_TIMEOUT_MS) });
  return await res.json();
}

async function fetchCore(fetchFn: typeof fetch, url: (q: string) => string): Promise<any[]> {
  try {
    const body = await getJson(fetchFn, url("metric=reach,views,saved,shares"));
    if (Array.isArray(body?.data)) return body.data;
    const msg = String(body?.error?.message ?? "");
    if (/share/i.test(msg)) {
      const body2 = await getJson(fetchFn, url("metric=reach,views,saved"));
      if (Array.isArray(body2?.data)) return body2.data;
    }
  } catch (_) { /* absent */ }
  return [];
}

async function fetchActions(fetchFn: typeof fetch, url: (q: string) => string): Promise<any[]> {
  try {
    const body = await getJson(fetchFn, url("metric=reposts,follows,profile_visits"));
    if (Array.isArray(body?.data)) return body.data;
    const code = body?.error?.code;
    if (typeof code === "number" && TRANSIENT_OR_AUTH_CODES.has(code)) return [];
    const body2 = await getJson(fetchFn, url("metric=reposts"));
    if (Array.isArray(body2?.data)) return body2.data;
  } catch (_) { /* absent */ }
  return [];
}

async function fetchBioLinkClicks(
  fetchFn: typeof fetch,
  url: (q: string) => string,
): Promise<number | undefined> {
  try {
    const body = await getJson(fetchFn, url("metric=profile_activity&breakdown=action_type"));
    return parseBioLinkClicks(body?.data);
  } catch (_) {
    return undefined;
  }
}

/**
 * Fetch per-post insights (three concurrent, isolated requests; see top of
 * file). Anything not returned is simply absent from `values`/`returned`.
 */
export async function fetchPostInsights(
  fetchFn: typeof fetch,
  mediaId: string,
  token: string,
): Promise<{ values: InsightValue; returned: Set<string> }> {
  const url = (query: string) =>
    `https://graph.instagram.com/${mediaId}/insights?${query}&access_token=${token}`;
  const [core, actions, bio] = await Promise.all([
    fetchCore(fetchFn, url),
    fetchActions(fetchFn, url),
    fetchBioLinkClicks(fetchFn, url),
  ]);
  const values: InsightValue = {};
  const returned = new Set<string>();
  parseInto(core, values, returned);
  parseInto(actions, values, returned);
  if (typeof bio === "number") {
    values.bio_link_clicks = bio;
    returned.add("bio_link_clicks");
  }
  return { values, returned };
}

type Counts = { reach: number; impressions: number; saved: number; shares: number; likes: number; comments: number };
type ActionCounts = {
  reposts: number | null;
  profile_visits: number | null;
  follows: number | null;
  bio_link_clicks: number | null;
};

/**
 * Build a COMPLETE payload for the metric columns (no omitted keys, so
 * PostgREST bulk upserts can't fill them with null/default). For each metric:
 * use the freshly-fetched value when returned, else preserve the previous value,
 * else 0 for the original counts / null for the action metrics (null = no data,
 * rendered as "—"). `unavailable_metrics` lists everything not freshly returned.
 */
export function buildMetricFields(
  existing: (Partial<Counts> & Partial<ActionCounts>) | null,
  insights: { values: InsightValue; returned: Set<string> },
  mediaNode: { like_count?: number; comments_count?: number },
): Counts & ActionCounts & { unavailable_metrics: string[] } {
  const unavailable: string[] = [];
  const pick = (token: keyof Counts, fresh: number | undefined, present: boolean): number => {
    if (present && typeof fresh === "number") return fresh;
    unavailable.push(token);
    return existing?.[token] ?? 0;
  };
  const pickNullable = (token: keyof ActionCounts): number | null => {
    const fresh = insights.values[token];
    if (insights.returned.has(token) && typeof fresh === "number") return fresh;
    unavailable.push(token);
    return existing?.[token] ?? null;
  };
  return {
    reach: pick("reach", insights.values.reach, insights.returned.has("reach")),
    impressions: pick("impressions", insights.values.impressions, insights.returned.has("impressions")),
    saved: pick("saved", insights.values.saved, insights.returned.has("saved")),
    shares: pick("shares", insights.values.shares, insights.returned.has("shares")),
    likes: pick("likes", mediaNode.like_count, typeof mediaNode.like_count === "number"),
    comments: pick("comments", mediaNode.comments_count, typeof mediaNode.comments_count === "number"),
    reposts: pickNullable("reposts"),
    profile_visits: pickNullable("profile_visits"),
    follows: pickNullable("follows"),
    bio_link_clicks: pickNullable("bio_link_clicks"),
    unavailable_metrics: unavailable,
  };
}
