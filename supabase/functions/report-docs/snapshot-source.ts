// Snapshot de dados de um cliente/mês: extraído de generate.ts para ser
// compartilhado com POST /:id/refresh-data (spec §5). Puro quanto a decisões:
// quem chama já validou ownership do cliente e entitlement.
import { mapAudience, mapBestTimes } from "../instagram-report-generator-v2/mappers.ts";
import {
  cachePostThumbnail, isEphemeralInstagramUrl, type ThumbnailStorage,
} from "../_shared/instagram-thumbnail-cache.ts";
import { monthWindow, prevMonthOf } from "../_shared/report-docs/month-window.ts";
import {
  assembleSnapshot, MAX_SNAPSHOT_POSTS, type ReportDocSnapshot, type SnapshotPostRow,
} from "../_shared/report-docs/snapshot.ts";
import type { TagPerformance } from "../_shared/report-template/types.ts";
import { GenerateError } from "./errors.ts";

export interface SnapshotDeps {
  fetch: typeof fetch;
  storage: ThumbnailStorage;
}

// deno-lint-ignore no-explicit-any
type Db = any;

// Anota o resultado da RPC com `error` opcional: sem isso, `.then` e `.catch`
// inferem tipos de retorno diferentes (a shape do .then não tinha `error`) e
// `tagPerformanceRes.error` abaixo não tipa -- comportamento em runtime não
// muda, só a inferência de tipo do resultado combinado.
type TagPerfResult = { data: TagPerformance[] | null; error?: { message?: string } | null };

export async function loadClientSnapshot(
  db: Db,
  deps: SnapshotDeps,
  contaId: string,
  cliente: { id: number; especialidade: string | null },
  month: string,
): Promise<{ snapshot: ReportDocSnapshot; igAccountId: string }> {
  const w = monthWindow(month);

  // Conta IG do cliente. instagram_accounts NÃO tem conta_id (baseline
  // 20260301:171-188): o ownership do workspace já foi provado pelo chamador
  // via clientes.conta_id, e client_id é UNIQUE na tabela — buscar só por ele.
  const { data: account } = await db.from("instagram_accounts")
    .select("*")
    .eq("client_id", cliente.id).maybeSingle();
  if (!account) throw new GenerateError("not_found", "Conta Instagram não conectada");

  const igAccountId = account.id;
  const prevW = monthWindow(prevMonthOf(month));
  const prevPrevW = monthWindow(prevMonthOf(prevMonthOf(month)));

  const lastSnapshotOfMonth = (win: typeof w) =>
    db.from("instagram_account_metrics_daily").select("*")
      .eq("instagram_account_id", igAccountId)
      .gte("snapshot_date", win.startDate).lt("snapshot_date", win.endDateExclusive)
      .order("snapshot_date", { ascending: false }).limit(1);

  const [
    postsRes, followerHistoryRes, demographicsRes, bestTimesRes, tagPerformanceRes,
    workspaceRes, prevPrevSnapRes, prevSnapRes, currSnapRes, prevMonthPostsRes,
  ] = await Promise.all([
    db.from("instagram_posts").select("*")
      .eq("instagram_account_id", igAccountId)
      .gte("posted_at", w.start).lt("posted_at", w.endExclusive)
      .order("posted_at", { ascending: false }),
    db.from("instagram_follower_history").select("date, follower_count")
      .eq("instagram_account_id", igAccountId)
      .gte("date", w.startDate).lt("date", w.endDateExclusive)
      .order("date", { ascending: true }),
    db.from("instagram_analytics_cache").select("data")
      .eq("instagram_account_id", igAccountId).eq("cache_key", "demographics").maybeSingle(),
    db.from("instagram_analytics_cache").select("data")
      .eq("instagram_account_id", igAccountId).eq("cache_key", "best_times").maybeSingle(),
    Promise.resolve(db.rpc("get_tag_performance", {
      p_instagram_account_id: igAccountId,
      p_month_start: w.start,
      // `endInclusive`, not `endExclusive`: this RPC's body is not in this repo,
      // so its bound semantics are left exactly as they were (parity with
      // instagram-report-generator-v2/index.ts's own endInclusive derivation).
      p_month_end: new Date(Date.parse(w.endExclusive) - 1).toISOString(),
    })).then((r: TagPerfResult) => r).catch((): TagPerfResult => ({ data: null })),
    db.from("workspaces").select("name, logo_url, brand_color, report_splash_url")
      .eq("id", contaId).single(),
    lastSnapshotOfMonth(prevPrevW),
    lastSnapshotOfMonth(prevW),
    lastSnapshotOfMonth(w),
    db.from("instagram_posts").select("reach, saved, likes, comments, shares")
      .eq("instagram_account_id", igAccountId)
      .gte("posted_at", prevW.start).lt("posted_at", prevW.endExclusive),
  ]);

  // Fontes OBRIGATÓRIAS: erro aqui não é "sem dados", é geração inválida.
  // As demais fontes degradam com log, como no gerador v2.
  if (postsRes.error) throw new Error(`posts query failed: ${postsRes.error.message}`);
  if (workspaceRes.error || !workspaceRes.data) {
    throw new Error(`workspace query failed: ${workspaceRes.error?.message ?? "no row"}`);
  }

  // Fontes opcionais: erro degrada o relatório (essa parte fica de fora), não
  // invalida a geração inteira. Log interno só -- nunca surfaced ao cliente
  // (mesmo padrão do gerador v2, index.ts warnQueryError).
  const warnQueryError = (label: string, error: unknown) => {
    if (!error) return;
    const msg = (error as { message?: string })?.message ?? String(error);
    console.warn(`[report-docs] ${label} query failed: ${msg}`);
  };
  warnQueryError("follower history", followerHistoryRes.error);
  warnQueryError("demographics cache", demographicsRes.error);
  warnQueryError("best times cache", bestTimesRes.error);
  warnQueryError("tag performance", tagPerformanceRes.error);
  warnQueryError("prev-prev-month snapshot", prevPrevSnapRes.error);
  warnQueryError("prev-month snapshot", prevSnapRes.error);
  warnQueryError("report-month snapshot", currSnapRes.error);
  warnQueryError("prev-month posts", prevMonthPostsRes.error);

  const posts: SnapshotPostRow[] = postsRes.data ?? [];
  const ws = workspaceRes.data;

  // Thumbnails: só dos candidatos a top post; URL efêmera cacheia ou vira null.
  // Concorrente: pior caso ~15s (timeout por download), nunca 12x15 serial.
  const byReach = [...posts].sort(
    (a, b) => ((b as { reach: number | null }).reach ?? 0) - ((a as { reach: number | null }).reach ?? 0),
  ).slice(0, MAX_SNAPSHOT_POSTS);
  const stableThumbnails = new Map<string, string>();
  await Promise.all(byReach.map(async (post) => {
    const url = post.thumbnail_url;
    if (!url || !isEphemeralInstagramUrl(url)) return;
    const cached = await cachePostThumbnail(
      { fetch: deps.fetch, storage: deps.storage },
      igAccountId,
      // instagram_posts.instagram_post_id = id do Graph API (baseline
      // 20260301:194) — a MESMA chave que instagram-integration usa no path do
      // cache, então URLs já cacheadas são reutilizadas em vez de duplicadas.
      (post as unknown as { instagram_post_id: string }).instagram_post_id,
      url,
      null,
    );
    // Map escrito por tasks concorrentes: seguro -- event loop single-thread,
    // cada task escreve numa chave própria (a URL original do post).
    if (cached && !isEphemeralInstagramUrl(cached)) stableThumbnails.set(url, cached);
  }));

  const snapshot = assembleSnapshot({
    month,
    account: {
      handle: account.username ?? account.handle ?? "",
      specialty: [cliente.especialidade].filter(Boolean).join(" · "),
    },
    branding: {
      workspace_name: ws?.name ?? "Mesaas",
      logo_url: ws?.logo_url ?? null,
      splash_url: ws?.report_splash_url ?? null,
      accent_color: ws?.brand_color ?? "#171717",
    },
    kpiSources: {
      allPosts: posts,
      prevMonthPosts: prevMonthPostsRes.error ? null : (prevMonthPostsRes.data ?? []),
      currSnapshot: currSnapRes.data?.[0] ?? null,
      prevSnapshot: prevSnapRes.data?.[0] ?? null,
      prevPrevSnapshot: prevPrevSnapRes.data?.[0] ?? null,
      followerHistory: followerHistoryRes.data ?? [],
    },
    followerTrend: (followerHistoryRes.data ?? []).map(
      (r: { date: string; follower_count: number }) => ({ date: r.date, count: r.follower_count }),
    ),
    posts,
    stableThumbnails,
    audience: mapAudience(demographicsRes.data?.data ?? null),
    bestTimes: mapBestTimes(bestTimesRes.data?.data ?? []),
    tagsPerformance: (tagPerformanceRes.data as TagPerformance[] | null) ?? [],
  });

  return { snapshot, igAccountId };
}
