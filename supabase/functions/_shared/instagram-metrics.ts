// Shared Instagram per-post metric helpers, used by every sync site
// (instagram-integration connect + refresh, instagram-sync-cron). Pure /
// fetch-injectable so the preservation + availability logic is unit-tested.
//
// Three insights requests per post, run concurrently and isolated from each
// other: a failure in one never removes values another returned.
//   1. core:    reach,views,saved,shares (retried without shares)
//   2. actions: reposts,follows,profile_visits. On a non-transient error, split
//               into follows,profile_visits + reposts so one rejected metric
//               (reposts is the newest) can't take the others down. Meta
//               documents follows/profile_visits for FEED and STORY only.
//   3. bio:     profile_activity&breakdown=action_type -> bio_link_clicked. Its
//               own request: Meta errors when a breakdown is mixed with metrics
//               that don't support it.
// Calls 2 and 3 are pinned to GRAPH_VERSION: unversioned URLs use the app
// dashboard's default version, which can predate these metrics.

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
const GRAPH_VERSION = "v25.0";
// Graph rejections are otherwise silent (values just go absent). Log a sample
// per isolate so a systematic rejection is diagnosable without flooding logs.
// Never log the URL: it carries the access token.
const MAX_LOGGED_REJECTIONS = 5;
let loggedRejections = 0;

function logRejection(call: string, body: any): void {
  if (loggedRejections >= MAX_LOGGED_REJECTIONS) return;
  loggedRejections++;
  const e = body?.error;
  console.warn(
    `[ig-metrics] ${call} insights rejected: code=${e?.code ?? "?"} subcode=${e?.error_subcode ?? "-"} ` +
      String(e?.message ?? "no error body").slice(0, 200),
  );
}
// Graph error codes that mean "try later" (throttling, temporary; 80002 is
// Instagram's per-account rate limit) or "bad token". Retrying with fewer metrics can't fix these.
const TRANSIENT_OR_AUTH_CODES = new Set([1, 2, 4, 9, 17, 32, 613, 190, 80002]);

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
 * When the response is valid but has no such result, the value is 0 (the account
 * had no taps). When the request errors or the shape is unexpected, it is absent.
 * Specifically:
 * - Missing/non-object total_value → undefined (unexpected shape)
 * - No results array but total_value.value === 0 → 0 (valid: no profile activity)
 * - No results array and total_value.value > 0 → undefined (unexpected shape: activity
 *   exists but no breakdown)
 * - results array exists, no bio_link_clicked → 0 (valid: activity but no bio taps)
 * - bio_link_clicked exists with non-number value → undefined (unexpected shape)
 */
export function parseBioLinkClicks(data: unknown): number | undefined {
  if (!Array.isArray(data)) return undefined;
  const insight = data.find((i: any) => i?.name === "profile_activity");
  const total = insight?.total_value;
  if (!total || typeof total !== "object") {
    // Posts with no profile activity can come back with only `values`.
    return insight?.values?.[0]?.value === 0 ? 0 : undefined;
  }
  const results = total.breakdowns?.[0]?.results;
  if (!Array.isArray(results)) return total.value === 0 ? 0 : undefined;
  const hit = results.find(
    (r: any) => String(r?.dimension_values?.[0] ?? "").toLowerCase() === "bio_link_clicked",
  );
  return typeof hit?.value === "number" ? hit.value : (hit ? undefined : 0);
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
  let body: any;
  try {
    body = await getJson(fetchFn, url("metric=reposts,follows,profile_visits"));
  } catch (_) {
    return [];
  }
  if (Array.isArray(body?.data)) return body.data;
  logRejection("actions", body);
  const code = body?.error?.code;
  if (typeof code === "number" && TRANSIENT_OR_AUTH_CODES.has(code)) return [];
  const parts = await Promise.all(
    ["follows,profile_visits", "reposts"].map(async (metrics) => {
      try {
        const b = await getJson(fetchFn, url(`metric=${metrics}`));
        if (Array.isArray(b?.data)) return b.data;
        logRejection(`actions:${metrics}`, b);
      } catch (_) { /* absent */ }
      return [];
    }),
  );
  return parts.flat();
}

async function fetchBioLinkClicks(
  fetchFn: typeof fetch,
  url: (q: string) => string,
): Promise<number | undefined> {
  try {
    const body = await getJson(fetchFn, url("metric=profile_activity&breakdown=action_type"));
    if (!Array.isArray(body?.data)) logRejection("bio", body);
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
  const versionedUrl = (query: string) =>
    `https://graph.instagram.com/${GRAPH_VERSION}/${mediaId}/insights?${query}&access_token=${token}`;
  const [core, actions, bio] = await Promise.all([
    fetchCore(fetchFn, url),
    fetchActions(fetchFn, versionedUrl),
    fetchBioLinkClicks(fetchFn, versionedUrl),
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
