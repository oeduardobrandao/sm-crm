// KPIs do snapshot com a invariante do gerador v2: valor e prev de um card são
// SEMPRE a mesma medida (uma base por card). Sem prev comparável, prev = null
// e o widget mostra só o valor. Fonte da regra: comentários extensos em
// instagram-report-generator-v2/index.ts §5-6.
//
// Fontes de conta (reach/views/saves/accounts_engaged/profile_views/
// website_clicks/follows_and_unfollows) via AccountTotals (Fase de paridade
// com o app do Instagram, 2026-08-31) -- quem resolve a cadeia ao-vivo-ou-
// -linha-mensal é o chamador (snapshot-source.ts, Task 10); este arquivo só
// monta os cards a partir do que já chegou.

import type { AccountTotals } from "../instagram-account-metrics.ts";

export const KPI_IDS = [
  "followers_gained", "followers_total", "reach", "views", "engagement_rate",
  "saves", "posts_count", "profile_views", "website_clicks",
] as const;
export type ReportKpiId = (typeof KPI_IDS)[number];

/** Labels pt-BR por KPI. Fonte ÚNICA: o card do pacote React e o bloco de
 * metas da IA (tiptap-doc) leem daqui — id cru nunca chega ao cliente. */
export const KPI_LABELS_PT: Record<ReportKpiId, string> = {
  followers_gained: "Novos seguidores",
  followers_total: "Seguidores totais",
  // "Acumulado", não deduplicado: a Graph não expõe alcance único do mês
  // (baseline instagram-account-metrics.ts). "Alcance" sozinho convidava
  // comparação com o número de visitantes únicos do app do Instagram.
  reach: "Alcance acumulado",
  views: "Visualizações",
  engagement_rate: "Taxa de engajamento",
  saves: "Salvamentos",
  posts_count: "Publicações",
  profile_views: "Visitas ao perfil",
  website_clicks: "Cliques no link",
};

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

export interface KpiSources {
  // Métricas de conta na janela do mês (ao vivo OU linha mensal — o chamador
  // resolve a cadeia; kpis.ts só monta cards). null = indisponível.
  accountMonth: Partial<AccountTotals> | null;
  accountPrevMonth: Partial<AccountTotals> | null;
  // Closes de seguidores (linha do ÚLTIMO dia do mês; spec §4.2.4) — null sem close.
  followersClose: number | null;
  followersPrevClose: number | null;
  // Fallback de followers_total para mês corrente (live count) e history do mês.
  followerHistory: { follower_count: number }[];
  // Só para posts_count e análises por post:
  allPosts: PostMetrics[];
  prevMonthPostsCount: number | null;
}

// Uma métrica simples de AccountTotals (reach/views/saves/profile_views/
// website_clicks): value = accountMonth[m]; prev = accountPrevMonth[m], mas
// só exposto quando o valor atual existe -- sem valor atual, comparar contra
// o mês anterior não faz sentido e o card já se omite (invariante da casa).
function accountMetric(
  month: Partial<AccountTotals> | null,
  prevMonth: Partial<AccountTotals> | null,
  key: "reach" | "views" | "saves" | "profile_views" | "website_clicks",
): { value: number | null; prev: number | null } {
  const value = typeof month?.[key] === "number" ? (month[key] as number) : null;
  if (value === null) return { value: null, prev: null };
  const prevRaw = prevMonth?.[key];
  const prev = typeof prevRaw === "number" ? prevRaw : null;
  return { value, prev };
}

export function computeKpis(s: KpiSources): Record<ReportKpiId, KpiEntry> {
  const reach = accountMetric(s.accountMonth, s.accountPrevMonth, "reach");
  const views = accountMetric(s.accountMonth, s.accountPrevMonth, "views");
  const saves = accountMetric(s.accountMonth, s.accountPrevMonth, "saves");
  const profileViews = accountMetric(s.accountMonth, s.accountPrevMonth, "profile_views");
  const websiteClicks = accountMetric(s.accountMonth, s.accountPrevMonth, "website_clicks");

  // followers_gained: preferência = net de follows_and_unfollows do mês (a
  // MESMA fonte de conta que reach/views/etc); fallback = close-to-close, e
  // só quando os DOIS closes existem -- um close sozinho não mede ganho
  // nenhum (o bug original: conta conectada no meio do mês computava um
  // delta de 5 dias como se fosse o ganho do mês inteiro). O fallback de
  // history parcial NÃO EXISTE MAIS.
  let gained: number | null = null;
  let gainedPrev: number | null = null;
  const netMonth = s.accountMonth?.follows_and_unfollows;
  if (netMonth) {
    gained = netMonth.net;
    const netPrev = s.accountPrevMonth?.follows_and_unfollows;
    // Percentual só entre dois ganhos POSITIVOS (ganho é grandeza com sinal;
    // -100 -> -50 daria "+50%" num mês de perda).
    if (netPrev && gained > 0 && netPrev.net > 0) gainedPrev = netPrev.net;
  } else if (s.followersClose !== null && s.followersPrevClose !== null) {
    gained = s.followersClose - s.followersPrevClose;
    // fallback close-to-close nunca expõe prev (base distinta do mês anterior).
  }

  // followers_total: close do mês; fallback = último ponto do history DO MÊS,
  // sempre sem prev (bases distintas). Nunca o live para mês passado.
  let total: number | null = s.followersClose;
  let totalPrev: number | null = null;
  if (total !== null && s.followersPrevClose !== null) totalPrev = s.followersPrevClose;
  if (total === null && s.followerHistory.length > 0) {
    total = s.followerHistory[s.followerHistory.length - 1].follower_count;
  }

  // engagement_rate: accounts_engaged / reach * 100, ambos não-null na MESMA
  // fonte. prev idem, na fonte do mês anterior -- só exposto quando o valor
  // atual existe (mesma regra de accountMetric acima).
  const engagedMonth = s.accountMonth?.accounts_engaged;
  const reachMonth = s.accountMonth?.reach;
  const engagement = typeof engagedMonth === "number" && typeof reachMonth === "number" && reachMonth > 0
    ? (engagedMonth / reachMonth) * 100
    : null;
  let engagementPrev: number | null = null;
  if (engagement !== null) {
    const engagedPrev = s.accountPrevMonth?.accounts_engaged;
    const reachPrev = s.accountPrevMonth?.reach;
    if (typeof engagedPrev === "number" && typeof reachPrev === "number" && reachPrev > 0) {
      engagementPrev = (engagedPrev / reachPrev) * 100;
    }
  }

  const postsPrev = s.prevMonthPostsCount;

  return {
    followers_gained: { value: gained, unit: "count", prev: gainedPrev },
    followers_total: { value: total, unit: "count", prev: totalPrev },
    reach: { value: reach.value, unit: "count", prev: reach.prev },
    views: { value: views.value, unit: "count", prev: views.prev },
    engagement_rate: { value: engagement, unit: "pct", prev: engagementPrev },
    saves: { value: saves.value, unit: "count", prev: saves.prev },
    posts_count: { value: s.allPosts.length, unit: "count", prev: postsPrev },
    profile_views: { value: profileViews.value, unit: "count", prev: profileViews.prev },
    website_clicks: { value: websiteClicks.value, unit: "count", prev: websiteClicks.prev },
  };
}
