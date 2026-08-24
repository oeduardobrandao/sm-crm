// Snapshot de dados de um cliente/mês: extraído de generate.ts para ser
// compartilhado com POST /:id/refresh-data (spec §5). Quem chama já validou
// ownership do cliente; este arquivo resolve por conta própria o entitlement
// feature_brand_customization (fail-closed) para a config whitelabel do Hub.
import { mapAudience, mapBestTimes } from "../instagram-report-generator-v2/mappers.ts";
import { decryptText } from "../_shared/crypto.ts";
import {
  cachePostThumbnail, isEphemeralInstagramUrl, type ThumbnailStorage,
} from "../_shared/instagram-thumbnail-cache.ts";
import { fetchAccountViews } from "./account-views.ts";
import { monthWindow, prevMonthOf } from "../_shared/report-docs/month-window.ts";
import {
  assembleSnapshot, MAX_SNAPSHOT_POSTS, type ReportDocSnapshot, type SnapshotHubTheme,
  type SnapshotPostRow,
} from "../_shared/report-docs/snapshot.ts";
import type { TagPerformance } from "../_shared/report-template/types.ts";
import { GenerateError } from "./errors.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";

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

// Mesma dupla de chaves de instagram-analytics/index.ts (decryptToken):
// HKDF com purpose primeiro, fallback legado com a chave crua padded. O
// segredo vem do CHAMADOR, que valida sua presença de forma síncrona e alta
// — assim a falha de decrypt aqui é sempre dado (token), nunca config.
async function decryptIgToken(encrypted: string, secret: string): Promise<string> {
  try {
    return await decryptText(encrypted, secret, "instagram-access-token");
  } catch {
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32)),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(buf);
  }
}

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

  // Regra da casa: TOKEN_ENCRYPTION_KEY é obrigatória, sem fallback. Config
  // ausente falha a geração ALTO e síncrono AQUI (nunca some no catch de
  // degradação abaixo, que existe para falha de DADO: token expirado, Graph
  // fora). Guard síncrono também evita rejection órfã se um throw anterior
  // abandonar a promise antes do await. Achado do review externo do PR #382.
  const encryptionSecret = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (account.encrypted_access_token && !encryptionSecret) {
    throw new Error("TOKEN_ENCRYPTION_KEY missing");
  }

  // Views da conta: Graph ao vivo, em paralelo com as queries abaixo. Fonte
  // OPCIONAL — falha de token/Graph degrada o card para null com log, nunca
  // derruba a geração.
  const accountViewsPromise: Promise<{ value: number | null; prev: number | null }> =
    (async () => {
      if (!account.encrypted_access_token) return { value: null, prev: null };
      const token = await decryptIgToken(account.encrypted_access_token, encryptionSecret!);
      return await fetchAccountViews(deps.fetch, token, month, Math.floor(Date.now() / 1000));
    })().catch((e) => {
      console.warn(
        `[report-docs] account views fetch failed: ${(e as Error)?.message ?? String(e)}`,
      );
      return { value: null, prev: null };
    });

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
    db.from("workspaces").select(
      "name, logo_url, brand_color, report_splash_url, hub_surface_theme, " +
        "hub_font_display, hub_font_body, hub_radius, hub_card_style",
    ).eq("id", contaId).single(),
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

  // Fail closed, mesmo padrão de defesa em profundidade de
  // hub-bootstrap/handler.ts:94-101: uma soluco na RPC de entitlements nunca
  // pode fazer a geracao do relatorio falhar -- so degrada o visual para o
  // neutro.
  let hubBrandCustomization = false;
  try {
    hubBrandCustomization = await effectivePlanFeature(db, contaId, "feature_brand_customization");
  } catch {
    // fail closed
  }
  const hubTheme: SnapshotHubTheme = hubBrandCustomization
    ? {
      surface: ws?.hub_surface_theme ?? "neutral",
      font_display: ws?.hub_font_display ?? "fraunces",
      font_body: ws?.hub_font_body ?? "instrument-sans",
      radius: ws?.hub_radius ?? "soft",
      card_style: ws?.hub_card_style ?? "filled",
    }
    : {
      surface: "neutral", font_display: "fraunces", font_body: "instrument-sans",
      radius: "soft", card_style: "filled",
    };

  // Thumbnails: só dos candidatos a top post; URL efêmera cacheia ou vira null.
  // Concorrente: pior caso ~15s (timeout por download), nunca 12x15 serial.
  // MESMA ordenação do assembleSnapshot (views desc, empate reach) — senão os
  // candidatos cacheados divergem dos posts que o widget de fato mostra.
  const byViews = [...posts].sort(
    (a, b) =>
      ((b.impressions ?? 0) - (a.impressions ?? 0)) || ((b.reach ?? 0) - (a.reach ?? 0)),
  ).slice(0, MAX_SNAPSHOT_POSTS);
  const stableThumbnails = new Map<string, string>();
  await Promise.all(byViews.map(async (post) => {
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

  const accountViews = await accountViewsPromise;

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
      hub_theme: hubTheme,
    },
    kpiSources: {
      allPosts: posts,
      prevMonthPosts: prevMonthPostsRes.error ? null : (prevMonthPostsRes.data ?? []),
      currSnapshot: currSnapRes.data?.[0] ?? null,
      prevSnapshot: prevSnapRes.data?.[0] ?? null,
      prevPrevSnapshot: prevPrevSnapRes.data?.[0] ?? null,
      followerHistory: followerHistoryRes.data ?? [],
      accountViews,
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
