// Seção TikTok do data_snapshot (spec 2026-10-28 §B3). Reusa as leituras e o cálculo de KPI do
// _shared/tiktok-analytics, então o relatório e a página de Analytics dão o mesmo número para a
// mesma janela. Toda fronteira é dia de São Paulo: o mês do relatório é [dia 1, último dia]
// em SP, cortado no dia de hoje (SP) quando o mês ainda está em curso.
//
// Quem chama já provou que o cliente é do workspace (clientes.conta_id); daqui em diante tudo é
// lido pela conta TikTok desse cliente.
import { mapBestTimes } from "../instagram-report-generator-v2/mappers.ts";
import { bestTimesFromPosts, tiktokRate } from "../_shared/best-times.ts";
import { lastDayOfMonth, saoPauloDate } from "../_shared/sao-paulo-date.ts";
import { monthWindow, prevMonthOf } from "../_shared/report-docs/month-window.ts";
import {
  CAPTION_PREVIEW_MAX, MAX_SNAPSHOT_POSTS, type TikTokReportSnapshot, type TikTokSnapshotTopPost,
} from "../_shared/report-docs/snapshot.ts";
import { computeTikTokKpis } from "../_shared/tiktok-analytics/kpis.ts";
import {
  loadFollowerHistory, loadTikTokAccount, loadVideosInWindow, type TikTokVideoDetailRow,
} from "../_shared/tiktok-analytics/queries.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** Mesmo corte do portfólio (queries.ts): conta desconectada ou revogada não entra. */
const NOT_CONNECTED = new Set(["disconnected", "revoked"]);
const BEST_TIMES_DAYS = 90;
const DAY_MS = 86_400_000;

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** likes_count da última linha diária com snapshot_date <= `date`; null sem linha. */
async function likesTotalOn(db: Db, accountId: string, date: string): Promise<number | null> {
  const { data, error } = await db.from("tiktok_account_metrics_daily").select("snapshot_date, likes_count")
    .eq("tiktok_account_id", accountId)
    .lte("snapshot_date", date)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = ((data ?? []) as { likes_count: number | null }[])[0];
  return typeof row?.likes_count === "number" ? row.likes_count : null;
}

function toTopPost(v: TikTokVideoDetailRow): TikTokSnapshotTopPost {
  return {
    video_id: v.tiktok_video_id,
    views: v.views ?? 0,
    likes: v.likes ?? 0,
    comments: v.comments ?? 0,
    shares: v.shares ?? 0,
    caption_preview: (v.title || v.video_description || "").slice(0, CAPTION_PREVIEW_MAX),
    date: v.posted_at,
    permalink: v.share_url,
    // cover_image_url já é a cópia re-hospedada no bucket tiktok-posts (nunca a CDN do TikTok).
    thumbnail_url: v.cover_image_url,
  };
}

export async function loadTikTokReportSection(
  db: Db,
  clientId: number,
  month: string,
  now: Date,
): Promise<{ section: TikTokReportSnapshot; accountId: string } | null> {
  const account = await loadTikTokAccount(db, clientId);
  if (!account || NOT_CONNECTED.has(account.authorization_status)) return null;

  const today = saoPauloDate(now);
  const start = monthWindow(month).startDate;
  const monthEnd = lastDayOfMonth(month);
  // Mês em curso termina hoje (SP); mês fechado, no último dia. Datas YYYY-MM-DD comparam lexicalmente.
  const end = monthEnd < today ? monthEnd : today;
  const includesToday = end === today;
  const prevMonth = prevMonthOf(month);
  const prevStart = monthWindow(prevMonth).startDate;
  const prevEnd = lastDayOfMonth(prevMonth);

  const [videos, prevVideos, history, prevHistory, recentVideos, likesTotalDaily] = await Promise.all([
    loadVideosInWindow(db, account.id, start, end),
    loadVideosInWindow(db, account.id, prevStart, prevEnd),
    loadFollowerHistory(db, account.id, start, end),
    loadFollowerHistory(db, account.id, prevStart, prevEnd),
    // Melhores horários: os 90 dias de SP que terminam no fim efetivo, como o /best-times da
    // página de Analytics (que termina hoje). Falha degrada para grade vazia, igual ao Instagram.
    loadVideosInWindow(db, account.id, addDays(end, -(BEST_TIMES_DAYS - 1)), end).catch((e) => {
      console.warn(`[report-docs] tiktok best times query failed: ${(e as Error)?.message ?? e}`);
      return [] as TikTokVideoDetailRow[];
    }),
    includesToday ? Promise.resolve(null) : likesTotalOn(db, account.id, end),
  ]);

  // Mesma regra do buildOverview (queries.ts): a contagem ao vivo só substitui o histórico
  // quando o mês termina hoje e ainda não há ponto observado hoje. Assim o relatório do mês em
  // curso mostra o mesmo "Seguidores" que a aba TikTok no mesmo dia.
  const windowEndsToday = includesToday && !history.some((p) => p.date === end);

  const kpis = computeTikTokKpis({
    videos,
    prevVideos,
    history,
    prevHistory,
    currentFollowers: account.follower_count,
    windowEndsToday,
    likesTotal: includesToday ? account.likes_count : likesTotalDaily,
  });

  const bestTimesPosts = recentVideos
    .filter((v): v is TikTokVideoDetailRow & { posted_at: string } => !!v.posted_at)
    .map((v) => ({ posted_at: v.posted_at, likes: v.likes, comments: v.comments, shares: v.shares, views: v.views }));

  // Mais vistos primeiro; empate decide pelo mais recente e depois pelo id, para a ordem não
  // depender da ordem das linhas do banco.
  const topPosts = [...videos]
    .sort((a, b) =>
      (b.views ?? 0) - (a.views ?? 0) ||
      String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? "")) ||
      a.tiktok_video_id.localeCompare(b.tiktok_video_id)
    )
    .slice(0, MAX_SNAPSHOT_POSTS)
    .map(toTopPost);

  return {
    accountId: account.id,
    section: {
      account: {
        handle: account.username ?? "",
        display_name: account.display_name,
        avatar_url: account.avatar_url,
      },
      kpis,
      follower_trend: history.map((p) => ({ date: p.date, count: p.follower_count })),
      best_times: mapBestTimes(bestTimesFromPosts(bestTimesPosts, tiktokRate)),
      top_posts: topPosts,
    },
  };
}
