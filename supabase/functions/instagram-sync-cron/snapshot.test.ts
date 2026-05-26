import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildSnapshotRow } from "./snapshot.ts";

Deno.test("buildSnapshotRow builds correct row from account metrics", () => {
  const row = buildSnapshotRow("acc-uuid-123", {
    followers_count: 4827,
    reach_28d: 45200,
    impressions_28d: 62000,
    profile_views_28d: 1200,
    website_clicks_28d: 89,
  });
  assertEquals(row.instagram_account_id, "acc-uuid-123");
  assertEquals(row.followers_count, 4827);
  assertEquals(row.reach_28d, 45200);
  assertEquals(row.impressions_28d, 62000);
  assertEquals(row.profile_views_28d, 1200);
  assertEquals(row.website_clicks_28d, 89);
  assertEquals(typeof row.snapshot_date, "string");
});

Deno.test("buildSnapshotRow handles null/undefined metrics gracefully", () => {
  const row = buildSnapshotRow("acc-uuid-456", {
    followers_count: 100,
    reach_28d: null,
    impressions_28d: undefined,
    profile_views_28d: 0,
    website_clicks_28d: null,
  });
  assertEquals(row.followers_count, 100);
  assertEquals(row.reach_28d, null);
  assertEquals(row.impressions_28d, null);
  assertEquals(row.profile_views_28d, 0);
  assertEquals(row.website_clicks_28d, null);
});
