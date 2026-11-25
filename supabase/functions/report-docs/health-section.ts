// Saúde do Instagram no snapshot do relatório (spec 2026-11-25-ig-account-health-report-block §Snapshot):
// as 4 métricas contra contas do mesmo tamanho, ancoradas no corte do relatório e congeladas em
// data_snapshot.instagram_health. Fonte OPCIONAL: qualquer falha devolve null com log interno e
// nunca derruba a geração.
import { cachePostThumbnail, isEphemeralInstagramUrl } from "../_shared/instagram-thumbnail-cache.ts";
import type {
  FollowerBand, HealthMetricKey, InstagramHealthSnapshot, PeerBenchmark,
} from "../_shared/report-docs/health-types.ts";
import type { SnapshotDeps } from "./snapshot-source.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const DAY_MS = 86_400_000;
const FOLLOWER_LOOKBACK_DAYS = 7;
const METRIC_KEYS: HealthMetricKey[] = ["engagement_rate", "posts_30d", "reel_views", "reels_share"];

/** Corte do relatório: mês corrente usa o instante da geração, mês fechado usa o fim do mês. */
export function reportCutoffIso(endExclusive: string, nowIso: string): string {
  return new Date(Math.min(Date.parse(endExclusive), Date.parse(nowIso))).toISOString();
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Mesma conversão do `getAccountHealth` do CRM: numérico vem como string, só vale com 99 cortes. */
function toBenchmark(row: Record<string, unknown>): PeerBenchmark | null {
  if (!Array.isArray(row.cuts) || row.cuts.length !== 99) return null;
  const cuts = row.cuts.map((c) => Number(c));
  if (cuts.some((c) => !Number.isFinite(c))) return null;
  if (!METRIC_KEYS.includes(row.metric as HealthMetricKey)) return null;
  return {
    metric: row.metric as HealthMetricKey,
    source: row.source as PeerBenchmark["source"],
    sample_size: num(row.sample_size),
    cuts,
  };
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `currentFollowers` (instagram_accounts.follower_count) é o fallback sem histórico no corte. */
export async function loadInstagramHealth(
  db: Db,
  deps: SnapshotDeps,
  accountId: string,
  asOfIso: string,
  currentFollowers?: number | null,
): Promise<InstagramHealthSnapshot | null> {
  try {
    const asOfMs = Date.parse(asOfIso);
    // Seguidores no corte: último dia fechado antes dele, até 7 dias para trás.
    const upper = ymd(asOfMs - DAY_MS);
    const lower = ymd(asOfMs - DAY_MS - FOLLOWER_LOOKBACK_DAYS * DAY_MS);
    const histRes = await db.from("instagram_follower_history").select("date, follower_count")
      .eq("instagram_account_id", accountId).lte("date", upper).gte("date", lower)
      .order("date", { ascending: false }).limit(1);
    if (histRes.error) throw histRes.error;
    const histCount = num(histRes.data?.[0]?.follower_count);
    const followers = histCount ?? num(currentFollowers) ?? 0;

    const [metricsRes, bandRes] = await Promise.all([
      db.rpc("ig_account_health_metrics", {
        p_account_id: accountId, p_as_of: asOfIso, p_followers: followers,
      }),
      db.rpc("ig_follower_band", { p_followers: followers }),
    ]);
    if (metricsRes.error) throw metricsRes.error;
    if (bandRes.error) throw bandRes.error;
    const m = Array.isArray(metricsRes.data) ? metricsRes.data[0] : metricsRes.data;
    if (!m) return null;
    const band = (bandRes.data ?? null) as FollowerBand | null;

    const benchmarks: InstagramHealthSnapshot["benchmarks"] = {};
    if (band) {
      const bRes = await db.from("ig_peer_benchmarks").select("metric, source, sample_size, cuts")
        .eq("band", band);
      if (bRes.error) throw bRes.error;
      for (const row of bRes.data ?? []) {
        const b = toBenchmark(row);
        if (b) benchmarks[b.metric] = b;
      }
    }

    let bestPost: InstagramHealthSnapshot["best_post"] = null;
    const ratio = num(m.best_post_ratio);
    if (m.best_post_id && ratio !== null) {
      const pRes = await db.from("instagram_posts").select("instagram_post_id, permalink, thumbnail_url")
        .eq("id", m.best_post_id).maybeSingle();
      if (pRes.error) throw pRes.error;
      const post = pRes.data;
      let thumb: string | null = null;
      if (post) {
        const cached = await cachePostThumbnail(
          { fetch: deps.fetch, storage: deps.storage }, accountId, post.instagram_post_id,
          post.thumbnail_url ?? null, null,
        );
        thumb = cached && !isEphemeralInstagramUrl(cached) ? cached : null;
      }
      bestPost = { ratio, permalink: post?.permalink ?? null, thumbnail_url: thumb };
    }

    return {
      as_of: asOfIso,
      followers,
      band,
      metrics: {
        engagement_rate: num(m.engagement_rate),
        posts_30d: num(m.posts_30d),
        reel_views: num(m.reel_views),
        reels_share: num(m.reels_share),
      },
      benchmarks,
      best_post: bestPost,
    };
  } catch (e) {
    console.error("[report-docs] instagram_health", e);
    return null;
  }
}
