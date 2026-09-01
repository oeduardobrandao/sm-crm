// Ingestão de Stories ativos (janela de 24h) via Graph API: busca os stories
// abertos da conta, coleta insights com concorrência limitada, cacheia
// thumbnails efêmeras da CDN do Instagram e devolve agregados diários para
// upsert_metrics_daily (chamado por index.ts — Task 3, não por este módulo).
//
// Metric preservation: um story cujo fetch de insights falhou por completo
// (fetchStoryInsights devolve {}) nunca entra no upsert individual nem no
// agregado diário. O PostgREST .upsert() sobrescreve incondicionalmente em
// conflito — sem esse filtro, uma falha transitória gravaria null por cima de
// um valor bom já persistido. Excluir o story do agregado também evita somar
// um zero fabricado: se TODOS os stories de uma data falharem, essa data
// simplesmente não aparece no retorno, e upsert_metrics_daily (COALESCE)
// preserva o valor antigo por ausência de linha, não por null explícito.
import { runPool } from "./pool.ts";
import { isEphemeralInstagramUrl } from "../_shared/instagram-thumbnail-cache.ts";

export interface StoryDailyAgg {
  instagram_account_id: string;
  snapshot_date: string;
  stories_count_day: number;
  stories_reach_day: number;
  stories_impressions_day: number;
  stories_replies_day: number;
  stories_taps_forward_day: number;
  stories_taps_back_day: number;
  stories_exits_day: number;
}

interface StoryNode {
  id: string;
  media_type: string;
  thumbnail_url: string | null;
  timestamp: string;
}

interface InsightValue {
  reach?: number;
  impressions?: number;
  replies?: number;
  taps_forward?: number;
  taps_back?: number;
  exits?: number;
  shares?: number;
}

export interface StoryIngestOpts {
  fetchFn: typeof fetch;
  accountId: string;
  accessToken: string;
  // deno-lint-ignore no-explicit-any
  db: any;
  cacheThumb: (accountId: string, mediaId: string, url: string) => Promise<string | null>;
}

const GRAPH_TIMEOUT_MS = 10_000;
const MAX_STORIES = 50;
const INSIGHT_CONCURRENCY = 5;
const ALL_METRICS = "reach,impressions,replies,taps_forward,taps_back,exits,shares";
const NO_SHARES_METRICS = "reach,impressions,replies,taps_forward,taps_back,exits";

function parseInsights(data: { name: string; values?: { value: number }[] }[]): InsightValue {
  const out: InsightValue = {};
  for (const item of data) {
    const val = item.values?.[0]?.value;
    if (typeof val === "number") {
      (out as Record<string, number>)[item.name] = val;
    }
  }
  return out;
}

function hasAnyInsight(insights: InsightValue): boolean {
  return Object.keys(insights).length > 0;
}

/**
 * Fetches insights for a single story. Some stories 400 on the `shares`
 * metric specifically (older stories / certain media types are outside the
 * API's shares-eligibility window) — on any error whose message mentions
 * "share", retry once with `shares` dropped so the other six metrics aren't
 * lost. Any other failure (network, timeout, unparseable body, non-share
 * error) degrades to `{}` rather than throwing: one story's failure must
 * never abort the batch.
 */
async function fetchStoryInsights(
  fetchFn: typeof fetch,
  storyId: string,
  token: string,
): Promise<InsightValue> {
  const url = (metrics: string) =>
    `https://graph.instagram.com/${storyId}/insights?metric=${metrics}&access_token=${token}`;
  try {
    const res = await fetchFn(url(ALL_METRICS), { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
    const body = await res.json();
    if (Array.isArray(body?.data)) return parseInsights(body.data);

    const msg = String(body?.error?.message ?? "");
    if (/share/i.test(msg)) {
      const res2 = await fetchFn(url(NO_SHARES_METRICS), { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
      const body2 = await res2.json();
      if (Array.isArray(body2?.data)) return parseInsights(body2.data);
    }
  } catch (e) {
    console.warn(`[IG-SYNC-CRON] story-ingest: insight fetch failed for story ${storyId}:`, e);
  }
  return {};
}

// Date is always a UTC instant internally; toISOString formats in UTC
// regardless of the runtime's local timezone, so slicing it is explicit-UTC
// by construction (no local-timezone drift possible).
function toUtcDateStr(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Ingests active (non-expired) stories for one Instagram account: fetches
 * up to MAX_STORIES open stories, pulls insights per story with bounded
 * concurrency, upserts the per-story rows (skipping ones with no insight
 * data at all), and returns per-UTC-day aggregates for the caller to fold
 * into the `upsert_metrics_daily` RPC payload.
 */
export async function ingestStories(opts: StoryIngestOpts): Promise<StoryDailyAgg[]> {
  const { fetchFn, accountId, accessToken, db, cacheThumb } = opts;

  // 1) Fetch active stories. Any failure here (network, timeout, token
  // error, malformed body) is non-fatal to the sync batch: log and return no
  // aggregates for this account this round, same graceful-degradation style
  // as the rest of instagram-sync-cron.
  let stories: StoryNode[];
  try {
    const res = await fetchFn(
      `https://graph.instagram.com/me/stories?fields=id,media_type,thumbnail_url,timestamp&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) },
    );
    const body = await res.json();
    if (!Array.isArray(body?.data)) {
      console.warn(`[IG-SYNC-CRON] story-ingest: me/stories returned no data for account ${accountId}`);
      return [];
    }
    stories = (body.data as StoryNode[]).slice(0, MAX_STORIES);
  } catch (e) {
    console.warn(`[IG-SYNC-CRON] story-ingest: me/stories failed for account ${accountId}:`, e);
    return [];
  }

  if (stories.length === 0) return [];

  // 2) Fetch insights with bounded concurrency. fetchStoryInsights never
  // throws (it swallows its own errors into `{}`), so runPool's
  // stop-on-first-error behavior never actually triggers here.
  const insightsMap = new Map<string, InsightValue>();
  await runPool(stories, INSIGHT_CONCURRENCY, async (story) => {
    insightsMap.set(story.id, await fetchStoryInsights(fetchFn, story.id, accessToken));
  });

  // 3) Keep only stories we actually got data for (metric preservation —
  // see module header). Thumbnail caching is skipped for dropped stories
  // too: nothing downstream will persist that row this round, so caching
  // its thumbnail now would be wasted work.
  const storiesWithData = stories.filter((story) => hasAnyInsight(insightsMap.get(story.id) ?? {}));

  const syncedAt = new Date().toISOString();
  const rowsWithData = await Promise.all(storiesWithData.map(async (story) => {
    const insights = insightsMap.get(story.id) ?? {};
    let thumbUrl = story.thumbnail_url;
    if (thumbUrl && isEphemeralInstagramUrl(thumbUrl)) {
      const cached = await cacheThumb(accountId, story.id, thumbUrl);
      if (cached) thumbUrl = cached;
    }
    const postedAt = new Date(story.timestamp);
    return {
      instagram_account_id: accountId,
      instagram_media_id: story.id,
      media_type: story.media_type || "STORY",
      thumbnail_url: thumbUrl,
      posted_at: postedAt.toISOString(),
      expired_at: new Date(postedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      reach: insights.reach ?? null,
      impressions: insights.impressions ?? null,
      replies: insights.replies ?? null,
      taps_forward: insights.taps_forward ?? null,
      taps_back: insights.taps_back ?? null,
      exits: insights.exits ?? null,
      shares: insights.shares ?? null,
      synced_at: syncedAt,
    };
  }));

  // 4) Upsert individual story rows. PostgREST's upsert handles ON CONFLICT
  // directly; true COALESCE-style preservation across the *daily* columns is
  // the RPC's job (Task 3), not this per-row upsert's.
  if (rowsWithData.length > 0) {
    const { error } = await db
      .from("instagram_story_insights")
      .upsert(rowsWithData, {
        onConflict: "instagram_account_id,instagram_media_id",
        ignoreDuplicates: false,
      });
    if (error) {
      console.error(`[IG-SYNC-CRON] story-ingest: upsert failed for account ${accountId}:`, error);
      return [];
    }
  }

  // 5) Aggregate by UTC date, from the same rowsWithData set that was
  // upserted — a story with no data contributes to neither.
  const byDate = new Map<string, {
    count: number;
    reach: number;
    impressions: number;
    replies: number;
    taps_forward: number;
    taps_back: number;
    exits: number;
  }>();
  for (const row of rowsWithData) {
    const date = toUtcDateStr(row.posted_at);
    const agg = byDate.get(date) ?? {
      count: 0, reach: 0, impressions: 0, replies: 0, taps_forward: 0, taps_back: 0, exits: 0,
    };
    agg.count++;
    agg.reach += row.reach ?? 0;
    agg.impressions += row.impressions ?? 0;
    agg.replies += row.replies ?? 0;
    agg.taps_forward += row.taps_forward ?? 0;
    agg.taps_back += row.taps_back ?? 0;
    agg.exits += row.exits ?? 0;
    byDate.set(date, agg);
  }

  return [...byDate.entries()].map(([date, agg]) => ({
    instagram_account_id: accountId,
    snapshot_date: date,
    stories_count_day: agg.count,
    stories_reach_day: agg.reach,
    stories_impressions_day: agg.impressions,
    stories_replies_day: agg.replies,
    stories_taps_forward_day: agg.taps_forward,
    stories_taps_back_day: agg.taps_back,
    stories_exits_day: agg.exits,
  }));
}
