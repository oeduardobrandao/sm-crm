// Núcleo da geração: recebe db (service client) e deps injetáveis, devolve o id
// do documento criado. Síncrono, sem fila: spec §5.
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { generateAINarrative } from "../_shared/report-template/ai.ts";
import { mapAudience, mapBestTimes } from "../instagram-report-generator-v2/mappers.ts";
import {
  cachePostThumbnail, isEphemeralInstagramUrl, type ThumbnailStorage,
} from "../_shared/instagram-thumbnail-cache.ts";
import { monthWindow, prevMonthOf } from "../_shared/report-docs/month-window.ts";
import {
  assembleSnapshot, MAX_SNAPSHOT_POSTS, type SnapshotPostRow,
} from "../_shared/report-docs/snapshot.ts";
import { buildDefaultLayout } from "../_shared/report-docs/default-layout.ts";
import {
  aiGoalsDoc, aiRecommendationsDoc, aiSummaryDoc, fallbackSummaryParagraphs,
  fillAiBlocks, textDoc,
} from "../_shared/report-docs/tiptap-doc.ts";
import { snapshotToReportData } from "../_shared/report-docs/ai-input.ts";
import type { TagPerformance } from "../_shared/report-template/types.ts";

export interface GenerateDeps {
  fetch: typeof fetch;
  storage: ThumbnailStorage;
  geminiKey: string;
  userId: string;
}

export class GenerateError extends Error {
  constructor(public code: "not_found" | "bad_month" | "feature_disabled", msg?: string) {
    super(msg ?? code);
  }
}

// deno-lint-ignore no-explicit-any
type Db = any;

export async function generateReportDocument(
  db: Db,
  deps: GenerateDeps,
  contaId: string,
  clientId: number,
  month: string,
): Promise<{ id: string }> {
  // Mês válido e não futuro.
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  let w;
  try {
    w = monthWindow(month);
  } catch {
    throw new GenerateError("bad_month");
  }
  if (month > currentMonth) throw new GenerateError("bad_month");

  // Ownership explícito de TODO id: service role bypassa RLS (spec §5).
  const { data: cliente } = await db.from("clientes")
    .select("id, conta_id, nome, especialidade, include_ai_analysis")
    .eq("id", clientId).maybeSingle();
  if (!cliente || cliente.conta_id !== contaId) throw new GenerateError("not_found");

  if (!(await effectivePlanFeature(db, contaId, "feature_analytics_reports"))) {
    throw new GenerateError("feature_disabled");
  }

  // Conta IG do cliente. instagram_accounts NÃO tem conta_id (baseline
  // 20260301:171-188): o ownership do workspace já foi provado acima via
  // clientes.conta_id, e client_id é UNIQUE na tabela — buscar só por ele.
  const { data: account } = await db.from("instagram_accounts")
    .select("*")
    .eq("client_id", clientId).maybeSingle();
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
      p_month_end: w.endExclusive,
    })).then((r: { data: TagPerformance[] | null }) => r).catch(() => ({ data: null })),
    db.from("workspaces").select("name, logo_url, brand_color, report_splash_url")
      .eq("id", contaId).single(),
    lastSnapshotOfMonth(prevPrevW),
    lastSnapshotOfMonth(prevW),
    lastSnapshotOfMonth(w),
    db.from("instagram_posts").select("reach, saved, likes, comments, shares")
      .eq("instagram_account_id", igAccountId)
      .gte("posted_at", prevW.start).lt("posted_at", prevW.endExclusive),
  ]);

  const posts: SnapshotPostRow[] = postsRes.data ?? [];
  const ws = workspaceRes.data;

  // Thumbnails: só dos candidatos a top post; URL efêmera cacheia ou vira null.
  const byReach = [...posts].sort(
    (a, b) => ((b as { reach: number | null }).reach ?? 0) - ((a as { reach: number | null }).reach ?? 0),
  ).slice(0, MAX_SNAPSHOT_POSTS);
  const stableThumbnails = new Map<string, string>();
  for (const post of byReach) {
    const url = post.thumbnail_url;
    if (!url || !isEphemeralInstagramUrl(url)) continue;
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
    if (cached && !isEphemeralInstagramUrl(cached)) stableThumbnails.set(url, cached);
  }

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
      liveFollowerCount: account.follower_count ?? null,
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

  // IA: nunca derruba a geração (padrão do v2, index.ts:987-1017).
  let aiContent: unknown = null;
  let summaryDoc = textDoc(fallbackSummaryParagraphs(snapshot.kpis, snapshot.period.label));
  let recsDoc: unknown | null = null;
  let goalsDoc: unknown | null = null;
  const wantsAi = cliente.include_ai_analysis !== false;
  if (wantsAi && deps.geminiKey) {
    const ai = await generateAINarrative(snapshotToReportData(snapshot), deps.geminiKey);
    if (ai.status === "success" && ai.output) {
      aiContent = ai.output;
      summaryDoc = aiSummaryDoc(ai.output);
      recsDoc = aiRecommendationsDoc(ai.output);
      goalsDoc = aiGoalsDoc(ai.output);
    } else {
      console.warn(`[report-docs] AI falhou: ${"error" in ai ? ai.error : ai.status}`);
    }
  }

  const layout = fillAiBlocks(
    buildDefaultLayout({
      hasAi: wantsAi,
      hasAudience: snapshot.audience !== null,
      hasBestTimes: snapshot.best_times.length > 0,
      hasTags: snapshot.tags_performance.length > 0,
    }),
    { summary: summaryDoc, recommendations: recsDoc, goals: goalsDoc },
  );

  const { data: inserted, error: insertError } = await db.from("report_documents")
    .insert({
      conta_id: contaId,
      client_id: clientId,
      instagram_account_id: igAccountId,
      title: `Relatório de ${w.label}`,
      period_start: w.startDate,
      period_end: w.endDateExclusive,
      layout,
      data_snapshot: snapshot,
      ai_content: aiContent,
      status: "ready",
      created_by: deps.userId,
    })
    .select("id").single();
  if (insertError || !inserted) {
    throw new Error(`insert failed: ${insertError?.message ?? "no row"}`);
  }
  return { id: inserted.id };
}
