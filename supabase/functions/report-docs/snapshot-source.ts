// Snapshot de dados de um cliente/mês: extraído de generate.ts para ser
// compartilhado com POST /:id/refresh-data (spec §5). Quem chama já validou
// ownership do cliente; este arquivo resolve por conta própria o entitlement
// feature_brand_customization (fail-closed) para a config whitelabel do Hub.
import { mapAudience, mapBestTimes } from "../instagram-report-generator-v2/mappers.ts";
import { decryptText } from "../_shared/crypto.ts";
import {
  cachePostThumbnail, isEphemeralInstagramUrl, type ThumbnailStorage,
} from "../_shared/instagram-thumbnail-cache.ts";
import {
  fetchAccountTotals, isWindowLiveEligible, type AccountMetric, type AccountTotals,
} from "../_shared/instagram-account-metrics.ts";
import {
  daysInMonth, lastDayOfMonth, resolveAccountWindow,
  type DailyMetricsRow, type MonthlyMetricsRow,
} from "./account-window.ts";
import { monthWindow, prevMonthOf, type MonthWindow } from "../_shared/report-docs/month-window.ts";
import {
  assembleSnapshot, MAX_SNAPSHOT_POSTS, type ReportDocSnapshot, type SnapshotHubTheme,
  type SnapshotPostRow,
} from "../_shared/report-docs/snapshot.ts";
import type { TagPerformance } from "../_shared/report-template/types.ts";
import { GenerateError } from "./errors.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";

// As 7 métricas de conta que a cadeia (Graph ao vivo -> linha mensal -> soma
// diária das aditivas) resolve por janela de mês -- spec §4.1/§4.3.
const ACCOUNT_METRICS: AccountMetric[] = [
  "reach", "views", "saves", "accounts_engaged", "profile_views", "website_clicks",
  "follows_and_unfollows",
];

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
  cliente: { id: number; especialidade: string | null; nome: string; foto_url: string | null },
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

  // Regra da casa: TOKEN_ENCRYPTION_KEY é obrigatória, sem fallback. Config
  // ausente falha a geração ALTO e síncrono AQUI (nunca some no catch de
  // degradação abaixo, que existe para falha de DADO: token expirado, Graph
  // fora). Guard síncrono também evita rejection órfã se um throw anterior
  // abandonar a promise antes do await. Achado do review externo do PR #382.
  const encryptionSecret = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (account.encrypted_access_token && !encryptionSecret) {
    throw new Error("TOKEN_ENCRYPTION_KEY missing");
  }

  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const nowIso = new Date(nowMs).toISOString();

  // Token decriptado UMA vez (elo 1 da cadeia de contas, spec §4.1/§4.3),
  // reusado pelas duas janelas (mês e mês anterior) abaixo -- ambas dependem
  // da MESMA promise, então o decrypt roda uma única vez mesmo que as duas
  // façam .then() nela. Fonte OPCIONAL: token ausente ou decrypt falho nunca
  // derruba a geração, só degrada esse elo pra null (a cadeia segue pros
  // elos 2/3).
  const tokenPromise: Promise<string | null> = account.encrypted_access_token
    ? decryptIgToken(account.encrypted_access_token, encryptionSecret!).catch((e) => {
      console.warn(
        `[report-docs] token decrypt failed: ${(e as Error)?.message ?? String(e)}`,
      );
      return null;
    })
    : Promise.resolve(null);

  // Elo 1 (Graph ao vivo) de UMA janela de mês: clampada em min(fim, agora) --
  // um mês em curso não pode pedir dado do futuro à Graph. Fonte OPCIONAL:
  // qualquer falha (token expirado, erro de rede, Graph fora) degrada pra
  // null com log; a cadeia (account-window.ts) segue pros elos 2/3.
  function liveAccountTotals(win: MonthWindow): Promise<Partial<AccountTotals> | null> {
    return tokenPromise.then((token) => {
      if (!token) return null;
      const sinceSec = Date.parse(win.start) / 1000;
      const untilSec = Math.min(Date.parse(win.endExclusive) / 1000, nowSec);
      // A month fully outside Graph's retention lookback (a historical report
      // month, well past the window) can never return real data live -- skip
      // the round-trip entirely rather than firing 7 metrics x 2 windows of
      // doomed requests before falling back to the monthly-row/daily-sum
      // snapshot chain below. A month that only partially overlaps retention
      // still goes live (unchanged): Graph errors on the out-of-range slice
      // degrade the same way any other per-metric failure does.
      if (!isWindowLiveEligible(sinceSec, untilSec, nowSec)) return null;
      return fetchAccountTotals(deps.fetch, token, ACCOUNT_METRICS, sinceSec, untilSec)
        .catch((e) => {
          console.warn(
            `[report-docs] account totals fetch failed (${win.month}): ` +
              `${(e as Error)?.message ?? String(e)}`,
          );
          return null;
        });
    });
  }
  const accountTotalsPromise = liveAccountTotals(w);
  const accountPrevTotalsPromise = liveAccountTotals(prevW);

  // Foto do cliente: MESMA prioridade do hub-bootstrap/handler.ts (upload manual
  // em clientes.foto_url primeiro, Instagram como fallback) -- achado do usuário
  // 2026-08-25, "onde estão as fotos dos clientes?": a capa só olhava pra
  // instagram_accounts.profile_picture_url e ignorava clientes.foto_url, então um
  // cliente com foto manual cadastrada mas sem foto de perfil sincronizada do
  // Instagram caía no fallback de iniciais à toa. Cacheada no MESMO
  // bucket/mecanismo dos thumbnails de post (achado de review externo 2026-08-25)
  // -- instagram_accounts.profile_picture_url NÃO é garantidamente estável: a
  // conexão inicial grava a URL efêmera crua do Graph
  // (instagram-integration/index.ts:382), só os crons de sync recacheiam depois.
  // clientes.foto_url já é estável por construção (upload direto pro storage,
  // nunca uma URL da CDN do Instagram) -- isEphemeralInstagramUrl nunca a
  // classifica como efêmera, então ela nunca entra no caminho de cache abaixo.
  // O data_snapshot é congelado para sempre, então precisa da MESMA blindagem
  // que os thumbnails de post já têm -- sem isso a foto quebraria quando a URL
  // efêmera expirasse, sem chance de autocorrigir depois.
  const rawAvatar = cliente.foto_url || account.profile_picture_url || null;
  const avatarUrlPromise: Promise<string | null> = isEphemeralInstagramUrl(rawAvatar)
    ? cachePostThumbnail({ fetch: deps.fetch, storage: deps.storage }, igAccountId, "avatar", rawAvatar, null)
      .then((cached) => (cached && !isEphemeralInstagramUrl(cached) ? cached : null))
    : Promise.resolve(rawAvatar);

  // Elo 2 (linha do mês fechado) e elo 3 (soma de *_day) da cadeia --
  // account-window.ts resolve os dois a partir do que essas queries trazem.
  const MONTHLY_COLUMNS = "reach_month, views_month, saves_month, accounts_engaged_month, " +
    "profile_views_month, website_clicks_month, follows_month, unfollows_month";
  const monthlyRowOf = (win: MonthWindow) =>
    db.from("instagram_account_metrics_monthly").select(MONTHLY_COLUMNS)
      .eq("instagram_account_id", igAccountId).eq("month", win.startDate).maybeSingle();

  // Linhas diárias do mês INTEIRO (não só a última): o elo 3 precisa somar
  // todos os dias com cobertura completa, e o "close" de seguidores (spec
  // §4.2.4) é a linha do ÚLTIMO DIA do mês -- nunca "última linha disponível
  // dentro do mês" (o bug original da Healing Hands). Um único round-trip
  // serve os dois usos.
  const DAILY_COLUMNS = "snapshot_date, followers_count, reach_day, views_day, saves_day, " +
    "accounts_engaged_day, profile_views_day, website_clicks_day, follows_day, unfollows_day";
  const dailyRowsOf = (win: MonthWindow) =>
    db.from("instagram_account_metrics_daily").select(DAILY_COLUMNS)
      .eq("instagram_account_id", igAccountId)
      .gte("snapshot_date", win.startDate).lt("snapshot_date", win.endDateExclusive)
      .order("snapshot_date", { ascending: true });

  const [
    postsRes, followerHistoryRes, demographicsRes, bestTimesRes, tagPerformanceRes,
    workspaceRes, monthlyRowRes, prevMonthlyRowRes, dailyRowsRes, prevDailyRowsRes,
    prevMonthPostsRes,
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
    monthlyRowOf(w),
    monthlyRowOf(prevW),
    dailyRowsOf(w),
    dailyRowsOf(prevW),
    db.from("instagram_posts").select("reach, saved, likes, comments, shares, impressions")
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
  warnQueryError("report-month monthly metrics", monthlyRowRes.error);
  warnQueryError("prev-month monthly metrics", prevMonthlyRowRes.error);
  warnQueryError("report-month daily metrics", dailyRowsRes.error);
  warnQueryError("prev-month daily metrics", prevDailyRowsRes.error);
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

  const [accountLive, accountPrevLive, avatarUrl] = await Promise.all([
    accountTotalsPromise,
    accountPrevTotalsPromise,
    avatarUrlPromise,
  ]);

  // Elo 2/3 da cadeia, por janela: linha mensal (elo 2) + linhas diárias do
  // mês inteiro (elo 3, só aditivas -- account-window.ts decide) + o close
  // de seguidores (linha do ÚLTIMO DIA do mês, spec §4.2.4).
  const dailyRowsOfW: DailyMetricsRow[] = dailyRowsRes.data ?? [];
  const dailyRowsOfPrevW: DailyMetricsRow[] = prevDailyRowsRes.data ?? [];
  type DailyRowWithDate = DailyMetricsRow & { snapshot_date: string; followers_count: number | null };
  const followersCloseOf = (rows: DailyRowWithDate[], win: MonthWindow): number | null => {
    const lastDay = lastDayOfMonth(win.endDateExclusive);
    const row = rows.find((r) => r.snapshot_date === lastDay);
    return typeof row?.followers_count === "number" ? row.followers_count : null;
  };

  const accountMonth: Partial<AccountTotals> = resolveAccountWindow(
    accountLive,
    (monthlyRowRes.data as MonthlyMetricsRow | null) ?? null,
    dailyRowsOfW,
    daysInMonth(w.startDate, w.endDateExclusive),
  );
  const accountPrevMonth: Partial<AccountTotals> = resolveAccountWindow(
    accountPrevLive,
    (prevMonthlyRowRes.data as MonthlyMetricsRow | null) ?? null,
    dailyRowsOfPrevW,
    daysInMonth(prevW.startDate, prevW.endDateExclusive),
  );

  const snapshot = assembleSnapshot({
    month,
    nowIso,
    // Outlier do mês ANTERIOR (spec §4.3): erro na query ou mês sem posts
    // degradam igual, pro mesmo `comparison: null` (computeComparison trata
    // os dois casos da mesma forma).
    prevMonthPosts: prevMonthPostsRes.error
      ? null
      : (prevMonthPostsRes.data ?? []).map(
        (p: { impressions: number | null; reach: number | null }) => ({
          views: p.impressions ?? null,
          reach: p.reach ?? null,
        }),
      ),
    account: {
      handle: account.username ?? account.handle ?? "",
      specialty: [cliente.especialidade].filter(Boolean).join(" · "),
      profile_picture_url: avatarUrl,
      client_name: cliente.nome,
    },
    branding: {
      workspace_name: ws?.name ?? "Mesaas",
      logo_url: ws?.logo_url ?? null,
      splash_url: ws?.report_splash_url ?? null,
      accent_color: ws?.brand_color ?? "#171717",
      hub_theme: hubTheme,
    },
    kpiSources: {
      accountMonth,
      accountPrevMonth,
      followersClose: followersCloseOf(dailyRowsOfW as DailyRowWithDate[], w),
      followersPrevClose: followersCloseOf(dailyRowsOfPrevW as DailyRowWithDate[], prevW),
      followerHistory: followerHistoryRes.data ?? [],
      allPosts: posts,
      prevMonthPostsCount: prevMonthPostsRes.error ? null : (prevMonthPostsRes.data ?? []).length,
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
