import { assertEquals } from "jsr:@std/assert";
import { buildDailyRows } from "../instagram-sync-cron/daily-ingest.ts";

Deno.test("buildDailyRows mapeia métricas para colunas *_day", () => {
  const daily = new Map([
    ["2026-08-29", { views: 100, reach: 40, follows: 3, unfollows: 1 }],
    ["2026-08-30", { views: null, saves: 2 }],
  ]);
  const rows = buildDailyRows("acc-1", daily);
  assertEquals(rows[0], {
    instagram_account_id: "acc-1", snapshot_date: "2026-08-29",
    reach_day: 40, views_day: 100, saves_day: null, accounts_engaged_day: null,
    profile_views_day: null, website_clicks_day: null, follows_day: 3, unfollows_day: 1,
  });
  assertEquals(rows[1].views_day, null); // null preservado (COALESCE no banco decide)
});
