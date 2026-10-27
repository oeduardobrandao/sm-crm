// Métricas do blog no Admin (spec 2026-10-27-blog-metrics). Views vêm das RPCs
// blog_view_stats() e blog_view_daily() (service_role). Os campos do Search Console
// vêm das RPCs blog_search_stats() / blog_search_series() e das tabelas blog_index_status,
// blog_search_runs e blog_search_daily (coletadas por blog-search-console-cron).
// A autorização (platform_admins) já aconteceu em index.ts.
//
// Só uma falha de leitura das views responde 500. Uma falha de leitura do Search Console é logada
// (só o nome da etapa) e derruba apenas a parte do Google: em blog-metrics, gsc_updated_at, search
// e index voltam null para todos (o Admin esconde tudo do Search Console quando gsc_updated_at é
// null, em vez de mostrar zeros sob uma data recente); em blog-post-metrics, search volta [].
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { BLOG_SLUG_RE } from "../_shared/blog-live.ts";

type Headers = Record<string, string>;

interface BlogViewStatsRow {
  slug: string;
  views_7d: unknown;
  views_30d: unknown;
  views_total: unknown;
}

interface BlogViewDailyRow {
  day: string;
  views: unknown;
}

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;
const DAY_MS = 86_400_000;

const json = (body: unknown, status: number, headers: Headers) =>
  new Response(JSON.stringify(body), { status, headers });
const internalError = (headers: Headers) => json({ error: "Internal server error" }, 500, headers);

// bigint chega do PostgREST como number ou string.
function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseInt(value, 10) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function clampDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(value)));
}

// "Hoje" como YYYY-MM-DD no calendário de São Paulo (en-CA formata assim).
function saoPauloToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

// Espelho local de PostMetrics em apps/admin/src/pages/blog/blog-view.ts (o Admin e o Deno nao
// compartilham tipos).
interface SearchTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

interface IndexStatus {
  verdict: string | null;
  coverage_state: string | null;
  last_crawl_time: string | null;
  inspection_link: string | null;
  checked_at: string;
}

interface PostMetrics {
  views_7d: number;
  views_30d: number;
  views_total: number;
  search: SearchTotals | null;
  index: IndexStatus | null;
}

const zeroMetrics = (): PostMetrics => ({
  views_7d: 0,
  views_30d: 0,
  views_total: 0,
  search: null,
  index: null,
});

interface BlogSearchStatsRow {
  slug: string;
  clicks: unknown;
  impressions: unknown;
  ctr: unknown;
  position: unknown;
}

interface BlogIndexRow {
  slug: string;
  verdict: string | null;
  coverage_state: string | null;
  last_crawl_time: string | null;
  inspection_link: string | null;
  checked_at: string;
}

interface BlogSearchSeriesRow {
  day: string;
  clicks: unknown;
  impressions: unknown;
}

const SEARCH_WINDOW_DAYS = 28;
// O link de inspecao vem do Google (o cron ja so grava https://search.google.com/...). Conferir de
// novo aqui evita que um valor estranho na tabela vire href no Admin.
const INSPECTION_PREFIX = "https://search.google.com/";

// numeric chega do PostgREST como number ou string.
function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

export async function handleBlogMetrics(svc: SupabaseClient, headers: Headers): Promise<Response> {
  const [views, search, index, run] = await Promise.all([
    svc.rpc("blog_view_stats"),
    svc.rpc("blog_search_stats", { p_days: SEARCH_WINDOW_DAYS }),
    svc
      .from("blog_index_status")
      .select("slug, verdict, coverage_state, last_crawl_time, inspection_link, checked_at"),
    svc
      .from("blog_search_runs")
      .select("finished_at")
      .eq("ok", true)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (views.error) {
    console.error("[platform-admin] blog-metrics: views read failed:", views.error);
    return internalError(headers);
  }
  const gscFailed = [
    search.error && "blog_search_stats",
    index.error && "blog_index_status",
    run.error && "blog_search_runs",
  ].filter(Boolean);
  if (gscFailed.length > 0) {
    console.error(`[platform-admin] blog-metrics: search console read failed (${gscFailed.join(", ")})`);
  }
  const gscOk = gscFailed.length === 0;

  // Um slug com dado so do Search Console (sem views) tambem entra, com views zeradas.
  const posts: Record<string, PostMetrics> = {};
  const entry = (slug: string): PostMetrics => (posts[slug] ??= zeroMetrics());

  for (const row of (views.data ?? []) as BlogViewStatsRow[]) {
    const m = entry(row.slug);
    m.views_7d = toCount(row.views_7d);
    m.views_30d = toCount(row.views_30d);
    m.views_total = toCount(row.views_total);
  }
  for (const row of (gscOk ? search.data ?? [] : []) as BlogSearchStatsRow[]) {
    entry(row.slug).search = {
      clicks: toCount(row.clicks),
      impressions: toCount(row.impressions),
      ctr: toNumber(row.ctr) ?? 0,
      position: toNumber(row.position),
    };
  }
  for (const row of (gscOk ? index.data ?? [] : []) as BlogIndexRow[]) {
    const link = str(row.inspection_link);
    entry(row.slug).index = {
      verdict: str(row.verdict),
      coverage_state: str(row.coverage_state),
      last_crawl_time: str(row.last_crawl_time),
      inspection_link: link !== null && link.startsWith(INSPECTION_PREFIX) ? link : null,
      checked_at: row.checked_at,
    };
  }

  const finishedAt = gscOk ? (run.data as { finished_at?: unknown } | null)?.finished_at : null;
  return json({ gsc_updated_at: str(finishedAt), posts }, 200, headers);
}

export async function handleBlogPostMetrics(
  svc: SupabaseClient,
  body: { slug?: unknown; days?: unknown },
  headers: Headers,
  now: Date = new Date(),
): Promise<Response> {
  const slug = body.slug;
  if (typeof slug !== "string" || !BLOG_SLUG_RE.test(slug)) {
    return json({ error: "invalid_request" }, 400, headers);
  }
  const days = clampDays(body.days);

  const [daily, series, latest] = await Promise.all([
    svc.rpc("blog_view_daily", { p_slug: slug, p_days: days }),
    svc.rpc("blog_search_series", { p_slug: slug, p_days: days }),
    // blog_search_series devolve so os dias com linha; a ancora da janela e o max(day) da tabela.
    svc.from("blog_search_daily").select("day").order("day", { ascending: false }).limit(1)
      .maybeSingle(),
  ]);
  if (daily.error) {
    console.error("[platform-admin] blog-post-metrics: views read failed:", daily.error);
    return internalError(headers);
  }
  const gscFailed = [series.error && "blog_search_series", latest.error && "blog_search_daily"].filter(Boolean);
  if (gscFailed.length > 0) {
    console.error(`[platform-admin] blog-post-metrics: search console read failed (${gscFailed.join(", ")})`);
  }

  // A RPC filtra por janela móvel mas agrupa por data de São Paulo, então pode devolver um dia
  // a mais (o mais antigo, parcial). Só entram as `days` datas terminando hoje.
  const byDay = new Map<string, number>();
  for (const row of (daily.data ?? []) as BlogViewDailyRow[]) byDay.set(row.day, toCount(row.views));

  const today = saoPauloToday(now);
  const views: Array<{ day: string; views: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = shiftDay(today, -i);
    views.push({ day, views: byDay.get(day) ?? 0 });
  }

  // Search Console usa os dias do Google, que terminam no ultimo dia com dado (2-3 dias atras).
  // Tabela vazia ou leitura falhou: serie vazia.
  const lastDay = gscFailed.length > 0 ? null : str((latest.data as { day?: unknown } | null)?.day);
  const searchByDay = new Map<string, { clicks: number; impressions: number }>();
  for (const row of (series.data ?? []) as BlogSearchSeriesRow[]) {
    searchByDay.set(row.day, { clicks: toCount(row.clicks), impressions: toCount(row.impressions) });
  }
  const search: Array<{ day: string; clicks: number; impressions: number }> = [];
  if (lastDay !== null) {
    for (let i = days - 1; i >= 0; i--) {
      const day = shiftDay(lastDay, -i);
      const hit = searchByDay.get(day);
      search.push({ day, clicks: hit?.clicks ?? 0, impressions: hit?.impressions ?? 0 });
    }
  }
  return json({ views, search }, 200, headers);
}
