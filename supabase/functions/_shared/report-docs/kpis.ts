// KPIs do snapshot com a invariante do gerador v2: valor e prev de um card são
// SEMPRE a mesma medida (uma base por card). Sem prev comparável, prev = null
// e o widget mostra só o valor. Fonte da regra: comentários extensos em
// instagram-report-generator-v2/index.ts §5-6.

export const KPI_IDS = [
  "followers_gained", "followers_total", "reach", "views", "engagement_rate",
  "saves", "posts_count", "profile_views", "website_clicks",
] as const;
export type ReportKpiId = (typeof KPI_IDS)[number];

export interface KpiEntry {
  /** null = sem dado nessa base (o widget se omite no viewer/print). */
  value: number | null;
  unit: "count" | "pct";
  prev: number | null;
}

interface PostMetrics {
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
}

interface MonthSnapshot {
  followers_count?: number | null;
  profile_views_28d?: number | null;
  website_clicks_28d?: number | null;
}

export interface KpiSources {
  allPosts: PostMetrics[];
  /** null = a query do mês anterior FALHOU (nunca confundir com []). */
  prevMonthPosts: PostMetrics[] | null;
  currSnapshot: MonthSnapshot | null;
  prevSnapshot: MonthSnapshot | null;
  prevPrevSnapshot: MonthSnapshot | null;
  /** Pontos do mês do relatório, ordem cronológica. */
  followerHistory: { follower_count: number }[];
  /** Views da conta no mês (Graph API ao vivo, resolvido pelo chamador).
   * null = fetch indisponível/falhou -> o card se omite (value null). */
  accountViews: { value: number | null; prev: number | null } | null;
}

const sum = (posts: PostMetrics[], key: keyof PostMetrics) =>
  posts.reduce((s, p) => s + (p[key] ?? 0), 0);

const interactions = (posts: PostMetrics[]) =>
  sum(posts, "likes") + sum(posts, "comments") + sum(posts, "saved") + sum(posts, "shares");

export function computeKpis(s: KpiSources): Record<ReportKpiId, KpiEntry> {
  const totalReach = sum(s.allPosts, "reach");
  const totalSaved = sum(s.allPosts, "saved");
  const totalInteractions = interactions(s.allPosts);
  const engagement = totalReach > 0 ? (totalInteractions / totalReach) * 100 : 0;

  const currClose = typeof s.currSnapshot?.followers_count === "number"
    ? s.currSnapshot.followers_count : null;
  const prevClose = typeof s.prevSnapshot?.followers_count === "number"
    ? s.prevSnapshot.followers_count : null;
  const prevPrevClose = typeof s.prevPrevSnapshot?.followers_count === "number"
    ? s.prevPrevSnapshot.followers_count : null;

  // followers_gained: preferência close-to-close; fallback history (sem prev).
  let gained: number | null = null;
  let gainedPrev: number | null = null;
  if (currClose !== null && prevClose !== null) {
    gained = currClose - prevClose;
    if (prevPrevClose !== null) {
      const prevGain = prevClose - prevPrevClose;
      // Percentual só entre dois ganhos POSITIVOS (ganho é grandeza com sinal;
      // -100 -> -50 daria "+50%" num mês de perda).
      if (gained > 0 && prevGain > 0) gainedPrev = prevGain;
    }
  } else if (s.followerHistory.length >= 2) {
    // Fallback usa só os DOIS PONTOS DENTRO DO MÊS (primeiro/último do
    // history) -- nunca o live count. Para um mês histórico (gerar maio em
    // agosto), o live já inclui crescimento posterior ao mês e o ganho
    // ficaria errado. Um único ponto não mede ganho nenhum: fica null.
    const first = s.followerHistory[0];
    const last = s.followerHistory[s.followerHistory.length - 1];
    gained = last.follower_count - first.follower_count;
  }

  // followers_total: close do mês; fallback = último ponto do history DO MÊS,
  // sempre sem prev (bases distintas). Nunca o live para mês passado.
  let total: number | null = currClose;
  let totalPrev: number | null = null;
  if (total !== null && prevClose !== null) totalPrev = prevClose;
  if (total === null && s.followerHistory.length > 0) {
    total = s.followerHistory[s.followerHistory.length - 1].follower_count;
  }

  // reach/saves/engagement/posts_count prev: base month-sum do mês anterior.
  let reachPrev: number | null = null;
  let savesPrev: number | null = null;
  let engagementPrev: number | null = null;
  let postsPrev: number | null = null;
  if (s.prevMonthPosts && s.prevMonthPosts.length > 0) {
    const pReach = sum(s.prevMonthPosts, "reach");
    const pSaved = sum(s.prevMonthPosts, "saved");
    if (pReach > 0) {
      reachPrev = pReach;
      engagementPrev = (interactions(s.prevMonthPosts) / pReach) * 100;
    }
    if (pSaved > 0) savesPrev = pSaved;
    postsPrev = s.prevMonthPosts.length;
  }

  // 28d: snapshot-a-snapshot ou nada (sem fallback pro live: outra base).
  const pv = typeof s.currSnapshot?.profile_views_28d === "number"
    ? s.currSnapshot.profile_views_28d : null;
  const pvPrev = pv !== null && typeof s.prevSnapshot?.profile_views_28d === "number"
    ? s.prevSnapshot.profile_views_28d : null;
  const wc = typeof s.currSnapshot?.website_clicks_28d === "number"
    ? s.currSnapshot.website_clicks_28d : null;
  const wcPrev = wc !== null && typeof s.prevSnapshot?.website_clicks_28d === "number"
    ? s.prevSnapshot.website_clicks_28d : null;

  const views = s.accountViews?.value ?? null;
  const viewsPrev = views !== null ? (s.accountViews?.prev ?? null) : null;

  return {
    followers_gained: { value: gained, unit: "count", prev: gainedPrev },
    followers_total: { value: total, unit: "count", prev: totalPrev },
    reach: { value: totalReach, unit: "count", prev: reachPrev },
    views: { value: views, unit: "count", prev: viewsPrev },
    engagement_rate: { value: engagement, unit: "pct", prev: engagementPrev },
    saves: { value: totalSaved, unit: "count", prev: savesPrev },
    posts_count: { value: s.allPosts.length, unit: "count", prev: postsPrev },
    profile_views: { value: pv, unit: "count", prev: pvPrev },
    website_clicks: { value: wc, unit: "count", prev: wcPrev },
  };
}
