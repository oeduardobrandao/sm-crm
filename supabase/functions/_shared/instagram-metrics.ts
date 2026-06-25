// Shared Instagram per-post metric helpers, used by every sync site
// (instagram-integration connect + refresh, instagram-sync-cron). Pure /
// fetch-injectable so the preservation + availability logic is unit-tested.

type InsightValue = { reach?: number; impressions?: number; saved?: number; shares?: number };
type ApiToken = "reach" | "views" | "saved" | "shares";
// API metric name -> our column token. `views` is stored as `impressions`.
const API_TO_COL: Record<ApiToken, "reach" | "impressions" | "saved" | "shares"> = {
  reach: "reach", views: "impressions", saved: "saved", shares: "shares",
};

function parseInsights(data: any[]): { values: InsightValue; returned: Set<string> } {
  const values: InsightValue = {};
  const returned = new Set<string>();
  for (const insight of data ?? []) {
    const col = API_TO_COL[insight?.name as ApiToken];
    const v = insight?.values?.[0]?.value;
    if (col && typeof v === "number") {
      values[col] = v;
      returned.add(col);
    }
  }
  return { values, returned };
}

/**
 * Fetch per-post insights. Tries reach,views,saved,shares; if the response is an
 * error mentioning `shares` (unsupported for some media types), retries without
 * shares so reach/views/saved are never lost to a shares-only rejection.
 * Any total failure yields an empty result (all metrics treated as absent).
 */
export async function fetchPostInsights(
  fetchFn: typeof fetch,
  mediaId: string,
  token: string,
): Promise<{ values: InsightValue; returned: Set<string> }> {
  const url = (metrics: string) =>
    `https://graph.instagram.com/${mediaId}/insights?metric=${metrics}&access_token=${token}`;
  try {
    const res = await fetchFn(url("reach,views,saved,shares"));
    const body = await res.json();
    if (Array.isArray(body?.data)) return parseInsights(body.data);
    const msg = String(body?.error?.message ?? "");
    if (/share/i.test(msg)) {
      const res2 = await fetchFn(url("reach,views,saved"));
      const body2 = await res2.json();
      if (Array.isArray(body2?.data)) return parseInsights(body2.data);
    }
  } catch (_) { /* fall through to empty */ }
  return { values: {}, returned: new Set() };
}

type Counts = { reach: number; impressions: number; saved: number; shares: number; likes: number; comments: number };

/**
 * Build a COMPLETE numeric payload for the metric columns (no omitted keys, so
 * PostgREST bulk upserts can't fill them with null/default). For each metric:
 * use the freshly-fetched value when returned, else preserve the previous value,
 * else 0 (new row). `unavailable_metrics` lists everything not freshly returned.
 */
export function buildMetricFields(
  existing: Partial<Counts> | null,
  insights: { values: InsightValue; returned: Set<string> },
  mediaNode: { like_count?: number; comments_count?: number },
): Counts & { unavailable_metrics: string[] } {
  const unavailable: string[] = [];
  const pick = (token: keyof Counts, fresh: number | undefined, present: boolean): number => {
    if (present && typeof fresh === "number") return fresh;
    unavailable.push(token);
    return existing?.[token] ?? 0;
  };
  return {
    reach: pick("reach", insights.values.reach, insights.returned.has("reach")),
    impressions: pick("impressions", insights.values.impressions, insights.returned.has("impressions")),
    saved: pick("saved", insights.values.saved, insights.returned.has("saved")),
    shares: pick("shares", insights.values.shares, insights.returned.has("shares")),
    likes: pick("likes", mediaNode.like_count, typeof mediaNode.like_count === "number"),
    comments: pick("comments", mediaNode.comments_count, typeof mediaNode.comments_count === "number"),
    unavailable_metrics: unavailable,
  };
}
