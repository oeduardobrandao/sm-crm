import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { renderReport } from "../_shared/report-template/render.ts";
import { convertHtmlToPdf } from "../_shared/report-template/pdf.ts";
import { generateAINarrative } from "../_shared/report-template/ai.ts";
import type {
  AIOutput,
  AudienceData,
  BestTimeSlot,
  ContentBreakdown,
  FollowerTrendPoint,
  KpiDeltas,
  KpiValue,
  ReportData,
  TagPerformance,
  TopPost,
  WorkspaceBranding,
} from "../_shared/report-template/types.ts";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_FUNCTION_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") ??
  (() => {
    throw new Error("INTERNAL_FUNCTION_SECRET is required");
  })();
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();
const GOTENBERG_URL = Deno.env.get("GOTENBERG_URL") ??
  (() => {
    throw new Error("GOTENBERG_URL is required");
  })();
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? "";

const MAX_EMBEDDED_THUMBNAIL_BYTES = 900_000;

const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPreviousMonth(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${
    String(prev.getMonth() + 1).padStart(2, "0")
  }`;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Fetches an image URL and returns a base64 data URI, or null on failure.
 * Skips oversized images to keep the report lightweight.
 */
async function fetchImageAsBase64(
  url: string,
  maxBytes = MAX_EMBEDDED_THUMBNAIL_BYTES,
): Promise<string | null> {
  const shortUrl = url.slice(0, 120);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[report-v2] thumb fetch ${res.status} for ${shortUrl}`);
      return null;
    }
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > maxBytes) {
      console.warn(`[report-v2] thumb too large (content-length ${contentLength}) for ${shortUrl}`);
      return null;
    }

    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0]
      .trim();
    if (!ct.startsWith("image/")) {
      console.warn(`[report-v2] thumb bad content-type "${ct}" for ${shortUrl}`);
      return null;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > maxBytes) {
      console.warn(`[report-v2] thumb body too large (${bytes.length} bytes) for ${shortUrl}`);
      return null;
    }
    return `data:${ct};base64,${bytesToBase64(bytes)}`;
  } catch (e) {
    console.warn(`[report-v2] thumb fetch error for ${shortUrl}: ${(e as Error).message}`);
    return null;
  }
}

async function getEncryptionKey(
  purpose: string,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(TOKEN_ENCRYPTION_KEY),
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: enc.encode(purpose),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    usage,
  );
}

async function decryptToken(encryptedBase64: string): Promise<string> {
  const combined = Uint8Array.from(
    atob(encryptedBase64),
    (c) => c.charCodeAt(0),
  );
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  try {
    const key = await getEncryptionKey("instagram-access-token", ["decrypt"]);
    const decryptedBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    const legacyKey = await getLegacyKey(["decrypt"]);
    const decryptedBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      legacyKey,
      data,
    );
    return new TextDecoder().decode(decryptedBuf);
  }
}

async function fetchFreshInstagramThumbnailUrls(
  posts: any[],
  encryptedAccessToken: string | null | undefined,
): Promise<Map<string, string>> {
  const urlsByDbId = new Map<string, string>();
  if (!TOKEN_ENCRYPTION_KEY || !encryptedAccessToken || posts.length === 0) {
    return urlsByDbId;
  }

  try {
    const accessToken = await decryptToken(encryptedAccessToken);
    const ids = posts
      .map((p) => p.instagram_post_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === 0) return urlsByDbId;

    const params = new URLSearchParams({
      ids: ids.join(","),
      fields: "thumbnail_url,media_url",
      access_token: accessToken,
    });
    const res = await fetch(`https://graph.instagram.com/?${params}`, {
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const data = await res.json();
      for (const post of posts) {
        const media = data[post.instagram_post_id];
        const url = media?.thumbnail_url || media?.media_url;
        if (url) urlsByDbId.set(post.id, url);
      }
    }

    const missingCarousels = posts.filter((post) =>
      post.media_type === "CAROUSEL_ALBUM" &&
      post.instagram_post_id &&
      !urlsByDbId.has(post.id)
    );

    await Promise.all(missingCarousels.map(async (post) => {
      try {
        const childParams = new URLSearchParams({
          fields: "media_url,media_type",
          limit: "1",
          access_token: accessToken,
        });
        const childRes = await fetch(
          `https://graph.instagram.com/${post.instagram_post_id}/children?${childParams}`,
          { signal: AbortSignal.timeout(15_000) },
        );
        if (!childRes.ok) return;
        const childData = await childRes.json();
        const childUrl = childData.data?.[0]?.media_url;
        if (childUrl) urlsByDbId.set(post.id, childUrl);
      } catch {
        // Keep the stored URL/placeholder for this one post.
      }
    }));
  } catch (e) {
    console.warn(
      "[report-v2] Could not refresh Instagram thumbnail URLs:",
      (e as Error).message,
    );
  }

  return urlsByDbId;
}

/**
 * Computes the percentage delta between two numbers.
 * Returns undefined when the previous value is zero or missing.
 */
function pctDelta(
  current: number | undefined,
  previous: number | undefined,
): number | undefined {
  if (previous === undefined || previous === null || previous === 0) {
    return undefined;
  }
  if (current === undefined || current === null) return undefined;
  return ((current - previous) / previous) * 100;
}

// ---------------------------------------------------------------------------
// Serve
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // --- Auth: internal token OR cron secret ---
  const internalToken = req.headers.get("X-Internal-Token") ?? "";
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  if (
    !timingSafeEqual(internalToken, INTERNAL_FUNCTION_SECRET) &&
    !timingSafeEqual(cronSecret, CRON_SECRET)
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  // --- Read body ---
  let reportId: string;
  try {
    const body = await req.json();
    reportId = body.reportId;
    if (!reportId) throw new Error("missing reportId");
  } catch {
    return json({ error: "reportId is required in request body" }, 400);
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // =====================================================================
    // 1. Fetch the analytics_reports row
    // =====================================================================
    const { data: report, error: reportErr } = await serviceClient
      .from("analytics_reports")
      .select("*")
      .eq("id", reportId)
      .single();

    if (reportErr || !report) {
      throw new Error(`Report not found: ${reportId}`);
    }

    const {
      instagram_account_id: igAccountId,
      client_id: clientId,
      conta_id: contaId,
      report_month: reportMonth,
      include_ai: includeAi,
    } = report;

    const month = reportMonth || getPreviousMonth();
    const [year, monthNum] = month.split("-").map(Number);
    const monthStart = new Date(year, monthNum - 1, 1).toISOString();
    const monthEnd = new Date(year, monthNum, 0, 23, 59, 59).toISOString();
    const monthStartDate = monthStart.split("T")[0];
    const monthEndDate = monthEnd.split("T")[0];

    // =====================================================================
    // 2. Fetch all source data in parallel
    // =====================================================================
    const [
      clienteRes,
      accountRes,
      topPostsRes,
      allPostsRes,
      followerHistoryRes,
      demographicsRes,
      bestTimesRes,
      tagPerformanceRes,
      workspaceRes,
    ] = await Promise.all([
      // Client info
      serviceClient.from("clientes").select("*").eq("id", clientId).single(),

      // Instagram account
      serviceClient.from("instagram_accounts").select("*").eq("id", igAccountId)
        .single(),

      // Top 5 posts by reach
      serviceClient
        .from("instagram_posts")
        .select("*")
        .eq("instagram_account_id", igAccountId)
        .gte("posted_at", monthStart)
        .lte("posted_at", monthEnd)
        .order("reach", { ascending: false })
        .limit(5),

      // All posts for the month (for content breakdown + totals)
      serviceClient
        .from("instagram_posts")
        .select("*")
        .eq("instagram_account_id", igAccountId)
        .gte("posted_at", monthStart)
        .lte("posted_at", monthEnd)
        .order("posted_at", { ascending: false }),

      // Follower history
      serviceClient
        .from("instagram_follower_history")
        .select("date, follower_count")
        .eq("instagram_account_id", igAccountId)
        .gte("date", monthStartDate)
        .lte("date", monthEndDate)
        .order("date", { ascending: true }),

      // Demographics cache
      serviceClient
        .from("instagram_analytics_cache")
        .select("data")
        .eq("instagram_account_id", igAccountId)
        .eq("cache_key", "demographics")
        .single(),

      // Best times cache
      serviceClient
        .from("instagram_analytics_cache")
        .select("data")
        .eq("instagram_account_id", igAccountId)
        .eq("cache_key", "best_times")
        .single(),

      // Tag performance: join post_tag_assignments -> tags, instagram_posts
      Promise.resolve(serviceClient.rpc("get_tag_performance", {
        p_instagram_account_id: igAccountId,
        p_month_start: monthStart,
        p_month_end: monthEnd,
      })).then((res: { data: TagPerformance[] | null; error: unknown }) => res)
        .catch(() => ({ data: null, error: null })),

      // Workspace branding
      serviceClient
        .from("workspaces")
        .select(
          "name, logo_url, brand_color, report_secondary_color, report_accent_color, report_font_family, report_theme",
        )
        .eq("id", contaId)
        .single(),
    ]);

    const cliente = clienteRes.data;
    if (!cliente) throw new Error("Cliente não encontrado");
    if (cliente.conta_id !== contaId) {
      throw new Error("Client does not belong to workspace");
    }

    const account = accountRes.data;
    if (!account) throw new Error("Conta Instagram não encontrada");

    const topPosts = topPostsRes.data || [];
    const allPosts = allPostsRes.data || [];
    const followerHistory = followerHistoryRes.data || [];
    const demographics = demographicsRes.data?.data || null;
    const bestTimesRaw = bestTimesRes.data?.data || [];
    const tagPerformanceRaw =
      (tagPerformanceRes.data as TagPerformance[] | null) || [];

    // =====================================================================
    // 3. Fetch metrics snapshots for month-over-month deltas
    // =====================================================================
    const prevMonthNum = monthNum === 1 ? 12 : monthNum - 1;
    const prevYear = monthNum === 1 ? year - 1 : year;
    const prevMonthPrefix = `${prevYear}-${
      String(prevMonthNum).padStart(2, "0")
    }`;
    const currMonthPrefix = `${year}-${String(monthNum).padStart(2, "0")}`;

    const [prevSnapshotRes, currSnapshotRes] = await Promise.all([
      serviceClient
        .from("instagram_account_metrics_daily")
        .select("*")
        .eq("instagram_account_id", igAccountId)
        .like("date", `${prevMonthPrefix}%`)
        .order("date", { ascending: false })
        .limit(1),
      serviceClient
        .from("instagram_account_metrics_daily")
        .select("*")
        .like("date", `${currMonthPrefix}%`)
        .eq("instagram_account_id", igAccountId)
        .order("date", { ascending: false })
        .limit(1),
    ]);

    const prevSnapshot = prevSnapshotRes.data?.[0] || null;
    const currSnapshot = currSnapshotRes.data?.[0] || null;

    // =====================================================================
    // 4. Workspace branding + logo base64
    // =====================================================================
    const ws = workspaceRes.data;
    const workspaceName = ws?.name || "Mesaas";
    const logoBase64 = ws?.logo_url
      ? await fetchImageAsBase64(ws.logo_url)
      : null;

    const branding: WorkspaceBranding = {
      logo_base64: logoBase64,
      workspace_name: workspaceName,
      primary_color: ws?.brand_color || "#eab308",
      secondary_color: ws?.report_secondary_color || "#1e2430",
      accent_color: ws?.report_accent_color || "#6366f1",
      font_family: ws?.report_font_family || "DM Sans",
      theme: (ws?.report_theme as "dark" | "light") || "dark",
    };

    // =====================================================================
    // 5. Compute KPIs
    // =====================================================================
    const totalReach = allPosts.reduce(
      (s: number, p: any) => s + (p.reach || 0),
      0,
    );
    const totalLikes = allPosts.reduce(
      (s: number, p: any) => s + (p.likes || 0),
      0,
    );
    const totalComments = allPosts.reduce(
      (s: number, p: any) => s + (p.comments || 0),
      0,
    );
    const totalSaved = allPosts.reduce(
      (s: number, p: any) => s + (p.saved || 0),
      0,
    );
    const totalShares = allPosts.reduce(
      (s: number, p: any) => s + (p.shares || 0),
      0,
    );
    const totalInteractions = totalLikes + totalComments + totalSaved +
      totalShares;
    const avgEngagement = totalReach > 0
      ? (totalInteractions / totalReach) * 100
      : 0;

    const firstDayFollowers = followerHistory.length > 0
      ? followerHistory[0].follower_count
      : null;
    const followersGained = firstDayFollowers !== null
      ? account.follower_count - firstDayFollowers
      : 0;

    const kpis: Record<string, KpiValue> = {
      followers_gained: {
        id: "followers_gained",
        value: followersGained,
        unit: "count",
      },
      engagement_rate: {
        id: "engagement_rate",
        value: avgEngagement,
        unit: "pct",
      },
      reach: { id: "reach", value: totalReach, unit: "count" },
      saves: { id: "saves", value: totalSaved, unit: "count" },
      posts_count: { id: "posts_count", value: allPosts.length, unit: "count" },
      profile_views: {
        id: "profile_views",
        value: account.profile_views_28d || 0,
        unit: "count",
      },
      website_clicks: {
        id: "website_clicks",
        value: account.website_clicks_28d || 0,
        unit: "count",
      },
    };

    // =====================================================================
    // 6. Compute deltas from snapshots
    // =====================================================================
    const kpiDeltas: KpiDeltas = {};
    if (prevSnapshot && currSnapshot) {
      kpiDeltas.followers_pct_change = pctDelta(
        currSnapshot.follower_count,
        prevSnapshot.follower_count,
      );
      kpiDeltas.reach_pct_change = pctDelta(
        currSnapshot.reach,
        prevSnapshot.reach,
      );
      kpiDeltas.engagement_pct_change = pctDelta(
        currSnapshot.engagement_rate,
        prevSnapshot.engagement_rate,
      );
      kpiDeltas.saves_pct_change = pctDelta(
        currSnapshot.saves,
        prevSnapshot.saves,
      );
      kpiDeltas.profile_views_pct_change = pctDelta(
        currSnapshot.profile_views,
        prevSnapshot.profile_views,
      );
      kpiDeltas.website_clicks_pct_change = pctDelta(
        currSnapshot.website_clicks,
        prevSnapshot.website_clicks,
      );
    }

    // =====================================================================
    // 7. Content breakdown
    // =====================================================================
    const typeMapping: Record<string, keyof ContentBreakdown> = {
      REEL: "reels",
      VIDEO: "reels",
      CAROUSEL_ALBUM: "carousels",
      IMAGE: "images",
    };

    const breakdownAccum: Record<
      string,
      { count: number; totalReach: number; totalEng: number }
    > = {};
    for (const p of allPosts) {
      const key = typeMapping[p.media_type] || "images";
      if (!breakdownAccum[key]) {
        breakdownAccum[key] = { count: 0, totalReach: 0, totalEng: 0 };
      }
      breakdownAccum[key].count++;
      breakdownAccum[key].totalReach += p.reach || 0;
      const eng = p.reach > 0
        ? ((p.likes || 0) + (p.comments || 0) + (p.saved || 0) +
          (p.shares || 0)) / p.reach
        : 0;
      breakdownAccum[key].totalEng += eng;
    }

    const contentBreakdown: ContentBreakdown = {};
    for (const [key, acc] of Object.entries(breakdownAccum)) {
      (contentBreakdown as any)[key] = {
        count: acc.count,
        avg_reach: acc.count > 0 ? Math.round(acc.totalReach / acc.count) : 0,
        avg_engagement: acc.count > 0 ? acc.totalEng / acc.count : 0,
      };
    }

    // =====================================================================
    // 8. Top posts + thumbnails
    // =====================================================================
    const MAX_REPORT_POSTS = 15;
    const allPostsSorted = [...allPosts].sort((a: any, b: any) =>
      (b.reach || 0) - (a.reach || 0)
    );
    const topPostsSlice = allPostsSorted.slice(0, MAX_REPORT_POSTS);
    const freshThumbnailUrls = await fetchFreshInstagramThumbnailUrls(
      topPostsSlice,
      account.encrypted_access_token,
    );
    console.log(`[report-v2] Fresh thumbnail URLs resolved: ${freshThumbnailUrls.size}/${topPostsSlice.length}`);
    const topPostThumbnails = await Promise.all(
      topPostsSlice.map(async (p: any) => {
        const candidates = [
          freshThumbnailUrls.get(p.id),
          p.thumbnail_url,
        ].filter((url, idx, arr): url is string =>
          typeof url === "string" && url.length > 0 && arr.indexOf(url) === idx
        );

        if (candidates.length === 0) {
          console.warn(`[report-v2] No thumbnail URL candidates for post ${p.id} (type=${p.media_type})`);
        }

        for (const url of candidates) {
          const base64 = await fetchImageAsBase64(url);
          if (base64) return { id: p.id, base64 };
        }
        return { id: p.id, base64: null };
      }),
    );
    const embeddedThumbnailCount = topPostThumbnails.filter((t) =>
      t.base64 !== null
    ).length;
    console.log(
      `[report-v2] Embedded ${embeddedThumbnailCount}/${topPostsSlice.length} post thumbnails`,
    );
    const thumbnailMap = new Map(
      topPostThumbnails.map((
        t: { id: string; base64: string | null },
      ) => [t.id, t.base64]),
    );

    const topPostsFormatted: TopPost[] = topPostsSlice.map((p: any) => {
      const interactions = (p.likes || 0) + (p.comments || 0) + (p.saved || 0) +
        (p.shares || 0);
      const eng = p.reach > 0 ? (interactions / p.reach) * 100 : 0;
      const typeLabel: TopPost["type"] =
        p.media_type === "VIDEO" || p.media_type === "REEL"
          ? "reel"
          : p.media_type === "CAROUSEL_ALBUM"
          ? "carousel"
          : "image";
      const caption = (p.caption || "").replace(/\n/g, " ").slice(0, 80);

      return {
        type: typeLabel,
        reach: p.reach || 0,
        engagement: eng,
        saves: p.saved || 0,
        likes: p.likes || 0,
        comments: p.comments || 0,
        caption_preview: caption || "Sem legenda",
        date: p.posted_at
          ? new Date(p.posted_at).toLocaleDateString("pt-BR")
          : undefined,
        thumbnail_base64: (thumbnailMap.get(p.id) as string | null) ?? null,
        permalink: p.permalink || undefined,
      };
    });

    // =====================================================================
    // 9. Audience data
    // =====================================================================
    const COUNTRY_NAMES: Record<string, string> = {
      BR: "Brasil",
      US: "Estados Unidos",
      PT: "Portugal",
      AR: "Argentina",
      MX: "México",
      CO: "Colômbia",
      CL: "Chile",
      PE: "Peru",
      UY: "Uruguai",
      PY: "Paraguai",
      EC: "Equador",
      VE: "Venezuela",
      BO: "Bolívia",
      ES: "Espanha",
      FR: "França",
      DE: "Alemanha",
      IT: "Itália",
      GB: "Reino Unido",
      CA: "Canadá",
      JP: "Japão",
      IN: "Índia",
      AU: "Austrália",
      AO: "Angola",
      MZ: "Moçambique",
      CV: "Cabo Verde",
    };

    let audience: AudienceData | null = null;
    if (demographics) {
      const rawCities = (demographics.cities || []).slice(0, 8);
      const cityTotal = rawCities.reduce((s: number, c: any) =>
        s + (c.count ?? c.pct ?? 0), 0) || 1;

      // age data is stored as "age_gender" with "age_range" field, or as "age_ranges" with "range" field
      const rawAges = (demographics.age_gender || demographics.age_ranges || [])
        .slice(0, 6);
      const ageTotal = rawAges.reduce((s: number, a: any) =>
        s + ((a.male ?? 0) + (a.female ?? 0) + (a.count ?? a.pct ?? 0)), 0) ||
        1;

      const rawCountries = (demographics.countries || []).slice(0, 5);
      const countryTotal = rawCountries.reduce((s: number, c: any) =>
        s + (c.count ?? c.pct ?? 0), 0) || 1;

      audience = {
        gender_split: {
          female: demographics.gender_split?.female ?? 0,
          male: demographics.gender_split?.male ?? 0,
        },
        top_cities: rawCities.map((c: any) => ({
          name: c.name,
          pct: ((c.count ?? c.pct ?? 0) / cityTotal) * 100,
        })),
        top_age_ranges: rawAges.map((a: any) => {
          const count = (a.male ?? 0) + (a.female ?? 0) +
            (a.count ?? a.pct ?? 0);
          return {
            range: a.age_range || a.range || a.name,
            pct: (count / ageTotal) * 100,
          };
        }),
        top_countries: rawCountries.map((c: any) => ({
          name: COUNTRY_NAMES[c.code] || c.name || c.code || "—",
          pct: ((c.count ?? c.pct ?? 0) / countryTotal) * 100,
        })),
      };
    }

    // =====================================================================
    // 10. Best times
    // =====================================================================
    const bestTimes: BestTimeSlot[] = Array.isArray(bestTimesRaw)
      ? bestTimesRaw.map((bt: any) => ({
        day: bt.day,
        hour: bt.hour,
        avg_engagement: bt.avg_engagement ?? bt.engagement ?? 0,
      }))
      : [];

    // =====================================================================
    // 11. Tag performance
    // =====================================================================
    const tagsPerformance: TagPerformance[] = tagPerformanceRaw.map((
      t: any,
    ) => ({
      tag: t.tag || t.name,
      avg_engagement: t.avg_engagement ?? 0,
      avg_reach: t.avg_reach ?? 0,
      count: t.count ?? 0,
    }));

    // =====================================================================
    // 12. Follower trend
    // =====================================================================
    const followerTrend: FollowerTrendPoint[] = followerHistory.map((
      fh: any,
    ) => ({
      date: fh.date,
      count: fh.follower_count,
    }));

    // =====================================================================
    // 13. Assemble ReportData
    // =====================================================================
    const periodLabel = `${MONTHS_PT[monthNum - 1]} ${year}`;
    const reportData: ReportData = {
      handle: `@${account.username}`,
      specialty: cliente.nicho || cliente.especialidade || "",
      period: periodLabel,
      kpis,
      kpi_deltas: kpiDeltas,
      top_posts: topPostsFormatted,
      content_breakdown: contentBreakdown,
      audience,
      best_times: bestTimes,
      tags_performance: tagsPerformance,
      follower_trend: followerTrend,
    };

    // =====================================================================
    // 14. AI narrative (if enabled + API key present)
    // =====================================================================
    let aiOutput: AIOutput | null = null;
    let aiStatus: string | null = null;
    let aiError: string | null = null;

    if (includeAi && GEMINI_API_KEY) {
      console.log(`[report-v2] Generating AI narrative for report ${reportId}`);
      const aiResult = await generateAINarrative(reportData, GEMINI_API_KEY);
      if (aiResult.status === "success") {
        aiOutput = aiResult.output;
        aiStatus = "success";
      } else {
        aiStatus = aiResult.status;
        aiError = aiResult.error;
        console.warn(`[report-v2] AI generation failed: ${aiResult.error}`);
      }
    } else if (includeAi && !GEMINI_API_KEY) {
      aiStatus = "skipped";
      aiError = "GEMINI_API_KEY not configured";
      console.warn(
        "[report-v2] AI requested but GEMINI_API_KEY is missing, skipping",
      );
    }

    // =====================================================================
    // 15. Render HTML
    // =====================================================================
    console.log(`[report-v2] Rendering HTML for report ${reportId}`);
    const html = renderReport({ data: reportData, branding, aiOutput });

    // =====================================================================
    // 16. Convert to PDF via Gotenberg
    // =====================================================================
    console.log(
      `[report-v2] Converting to PDF via Gotenberg for report ${reportId}`,
    );
    const pdfBytes = await convertHtmlToPdf(html, GOTENBERG_URL);

    // =====================================================================
    // 17. Upload HTML and PDF to Supabase Storage
    // =====================================================================
    const pdfPath = `reports/${contaId}/${clientId}/${month}.pdf`;
    const htmlPath = `reports/${contaId}/${clientId}/${month}.html`;

    const uploadFile = async (
      path: string,
      content: Uint8Array | string,
      contentType: string,
    ) => {
      const body = typeof content === "string"
        ? new TextEncoder().encode(content)
        : content;
      const { error } = await serviceClient.storage
        .from("analytics-reports")
        .upload(path, body, { contentType, upsert: true });

      if (error) {
        // Try creating the bucket and retry (same pattern as existing generator)
        console.warn(
          `[report-v2] Upload error for ${path}, attempting bucket creation:`,
          error.message,
        );
        await serviceClient.storage.createBucket("analytics-reports", {
          public: false,
        });
        const { error: retryError } = await serviceClient.storage
          .from("analytics-reports")
          .upload(path, body, { contentType, upsert: true });
        if (retryError) {
          throw new Error(`Failed to upload ${path}: ${retryError.message}`);
        }
      }
    };

    console.log(`[report-v2] Uploading PDF and HTML for report ${reportId}`);
    await Promise.all([
      uploadFile(pdfPath, pdfBytes, "application/pdf"),
      uploadFile(htmlPath, html, "text/html"),
    ]);

    // =====================================================================
    // 18. Update analytics_reports row
    // =====================================================================
    const updatePayload: Record<string, unknown> = {
      status: "ready",
      storage_path: pdfPath,
      html_storage_path: htmlPath,
      generated_at: new Date().toISOString(),
      generation_error: null,
    };

    if (aiOutput) {
      updatePayload.ai_content = aiOutput;
      updatePayload.ai_status = aiStatus;
      updatePayload.ai_error = null;
    } else if (aiStatus) {
      updatePayload.ai_content = null;
      updatePayload.ai_status = aiStatus;
      updatePayload.ai_error = aiError;
    }

    await serviceClient
      .from("analytics_reports")
      .update(updatePayload)
      .eq("id", reportId);

    console.log(`[report-v2] Report ${reportId} generated successfully`);

    return json({ success: true, reportId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[report-v2] Error generating report ${reportId}:`, message);

    // Update report row with failure status
    try {
      await serviceClient
        .from("analytics_reports")
        .update({
          status: "failed",
          generation_error: message,
        })
        .eq("id", reportId);
    } catch (updateErr) {
      console.error(
        "[report-v2] Failed to update report status to failed:",
        updateErr,
      );
    }

    return json({ error: "Report generation failed" }, 500);
  }
});
