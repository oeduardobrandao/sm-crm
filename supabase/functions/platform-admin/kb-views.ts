// Contagem de visualizações da Central de Ajuda (spec 2026-10-01-kb-content-view-counts-design).
// A agregação (janelas, pessoas únicas, exclusão de admins) vive em kb_view_stats() no banco;
// aqui só se separa por tipo e converte bigint (que pode chegar como string) para number.
// A autorização (platform_admins) já aconteceu em index.ts; erro sobe para o 500 genérico de lá.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Headers = Record<string, string>;

export interface KbViewStatsRow {
  kind: string;
  item_id: string;
  views_30d: unknown;
  users_30d: unknown;
  views_total: unknown;
  users_total: unknown;
  completed_total: unknown;
}

export interface KbViewStats {
  views_30d: number;
  users_30d: number;
  views_total: number;
  users_total: number;
}

export interface KbVideoViewStats extends KbViewStats {
  completed: number;
}

export interface KbViewStatsPayload {
  articles: Record<string, KbViewStats>;
  videos: Record<string, KbVideoViewStats>;
}

function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseInt(value, 10) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function baseStats(row: KbViewStatsRow): KbViewStats {
  return {
    views_30d: toCount(row.views_30d),
    users_30d: toCount(row.users_30d),
    views_total: toCount(row.views_total),
    users_total: toCount(row.users_total),
  };
}

export function shapeKbViewStats(rows: KbViewStatsRow[]): KbViewStatsPayload {
  const out: KbViewStatsPayload = { articles: {}, videos: {} };
  for (const row of rows) {
    if (row.kind === "article") {
      out.articles[row.item_id] = baseStats(row);
    } else if (row.kind === "video") {
      out.videos[row.item_id] = { ...baseStats(row), completed: toCount(row.completed_total) };
    }
  }
  return out;
}

export async function handleKbViewStats(svc: SupabaseClient, headers: Headers): Promise<Response> {
  const { data, error } = await svc.rpc("kb_view_stats");
  if (error) throw error;
  const payload = shapeKbViewStats((data ?? []) as KbViewStatsRow[]);
  return new Response(JSON.stringify(payload), { status: 200, headers });
}
