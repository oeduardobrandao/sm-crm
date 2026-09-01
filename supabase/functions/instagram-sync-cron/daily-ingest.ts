// Ingestão de DIAS FECHADOS (D-1..D-3 UTC) nas colunas *_day, via RPC
// upsert_metrics_daily (COALESCE: null nunca apaga; não-null novo vence —
// é a reconsulta corrigindo insights revisados pela Meta). Spec §4.2.1.
import {
  type DailyValues, fetchClosedDayValues,
} from "../_shared/instagram-account-metrics.ts";

const DAY = 86400;
export const CLOSED_DAYS_WINDOW = 3; // calibrado pelo spike §3.3

export interface DailyRow {
  instagram_account_id: string;
  snapshot_date: string;
  reach_day: number | null; views_day: number | null; saves_day: number | null;
  accounts_engaged_day: number | null; profile_views_day: number | null;
  website_clicks_day: number | null; follows_day: number | null;
  unfollows_day: number | null;
}

export function buildDailyRows(
  accountId: string, daily: Map<string, Partial<DailyValues>>,
): DailyRow[] {
  return [...daily.entries()].map(([date, v]) => ({
    instagram_account_id: accountId, snapshot_date: date,
    reach_day: v.reach ?? null, views_day: v.views ?? null,
    saves_day: v.saves ?? null, accounts_engaged_day: v.accounts_engaged ?? null,
    profile_views_day: v.profile_views ?? null,
    website_clicks_day: v.website_clicks ?? null,
    follows_day: v.follows ?? null, unfollows_day: v.unfollows ?? null,
  }));
}

// deno-lint-ignore no-explicit-any
export async function ingestClosedDays(
  db: any, fetchFn: typeof fetch, accountId: string, accessToken: string,
  nowSec: number,
): Promise<void> {
  const todayStart = Math.floor(nowSec / DAY) * DAY;
  // D-1..D-CLOSED_DAYS_WINDOW: dias FECHADOS, reconsultados a cada rodada
  // (insights podem ser revisados pela Meta). ~7 requests por dia coberto.
  const days: string[] = [];
  for (let i = CLOSED_DAYS_WINDOW; i >= 1; i--) {
    days.push(new Date((todayStart - i * DAY) * 1000).toISOString().slice(0, 10));
  }
  const daily = new Map<string, Partial<DailyValues>>();
  await Promise.all(days.map(async (day) => {
    daily.set(day, await fetchClosedDayValues(fetchFn, accessToken, day));
  }));
  const rows = buildDailyRows(accountId, daily);
  if (rows.length === 0) return;
  const { error } = await db.rpc("upsert_metrics_daily", { p_rows: rows });
  if (error) console.warn(`[IG-SYNC-CRON] upsert_metrics_daily failed: ${error.message}`);
}
