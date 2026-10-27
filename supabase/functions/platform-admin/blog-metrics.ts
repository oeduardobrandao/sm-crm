// Métricas do blog no Admin (spec 2026-10-27-blog-metrics). Views vêm das RPCs
// blog_view_stats() e blog_view_daily() (service_role). Os campos do Search Console
// (`search`, `index`, `gsc_updated_at`) existem no formato mas ficam nulos até a coleta existir.
// A autorização (platform_admins) já aconteceu em index.ts.
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

export async function handleBlogMetrics(svc: SupabaseClient, headers: Headers): Promise<Response> {
  const { data, error } = await svc.rpc("blog_view_stats");
  if (error) {
    console.error("[platform-admin] blog-metrics:", error);
    return internalError(headers);
  }
  const posts: Record<string, unknown> = {};
  for (const row of (data ?? []) as BlogViewStatsRow[]) {
    posts[row.slug] = {
      views_7d: toCount(row.views_7d),
      views_30d: toCount(row.views_30d),
      views_total: toCount(row.views_total),
      search: null,
      index: null,
    };
  }
  return json({ gsc_updated_at: null, posts }, 200, headers);
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

  const { data, error } = await svc.rpc("blog_view_daily", { p_slug: slug, p_days: days });
  if (error) {
    console.error("[platform-admin] blog-post-metrics:", error);
    return internalError(headers);
  }

  // A RPC filtra por janela móvel mas agrupa por data de São Paulo, então pode devolver um dia
  // a mais (o mais antigo, parcial). Só entram as `days` datas terminando hoje.
  const byDay = new Map<string, number>();
  for (const row of (data ?? []) as BlogViewDailyRow[]) byDay.set(row.day, toCount(row.views));

  const today = saoPauloToday(now);
  const views: Array<{ day: string; views: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = shiftDay(today, -i);
    views.push({ day, views: byDay.get(day) ?? 0 });
  }
  return json({ views, search: [] }, 200, headers);
}
