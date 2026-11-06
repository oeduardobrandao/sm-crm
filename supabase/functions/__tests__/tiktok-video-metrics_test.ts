// recordVideoSnapshots: the daily per-video history write shared by the video import and the
// metrics refresh (spec A1 "one write path for video counts").
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { recordVideoSnapshots } from "../_shared/tiktok-video-metrics.ts";

Deno.test("recordVideoSnapshots upserts one row per video on the São Paulo date", async () => {
  const db = createSupabaseQueryMock();
  // 01:30Z on the 29th is still the 28th at 22:30 in São Paulo.
  const now = new Date("2026-10-29T01:30:00Z");

  const written = await recordVideoSnapshots(
    db as never,
    "acct-1",
    [
      { tiktok_video_id: "v1", views: 100, likes: 10, comments: 2, shares: 1 },
      { tiktok_video_id: "v2", views: null, likes: null, comments: null, shares: null },
    ],
    now,
  );

  assertEquals(written, 2);
  const call = db.calls.find((c) => c.table === "tiktok_post_metrics_daily" && c.operation === "upsert");
  assert(call, "expected an upsert into tiktok_post_metrics_daily");
  assertEquals(call!.payload, [
    {
      tiktok_account_id: "acct-1",
      tiktok_video_id: "v1",
      snapshot_date: "2026-10-28",
      views: 100,
      likes: 10,
      comments: 2,
      shares: 1,
    },
    {
      tiktok_account_id: "acct-1",
      tiktok_video_id: "v2",
      snapshot_date: "2026-10-28",
      views: null,
      likes: null,
      comments: null,
      shares: null,
    },
  ]);
  assertEquals(
    (call!.options as { onConflict?: string }).onConflict,
    "tiktok_account_id,tiktok_video_id,snapshot_date",
  );
});

Deno.test("recordVideoSnapshots swallows a db error and returns 0", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_post_metrics_daily", "upsert", { data: null, error: { message: "boom" } });

  const written = await recordVideoSnapshots(
    db as never,
    "acct-1",
    [{ tiktok_video_id: "v1", views: 1, likes: 1, comments: 1, shares: 1 }],
    new Date("2026-10-28T15:00:00Z"),
  );

  assertEquals(written, 0);
});

Deno.test("recordVideoSnapshots swallows a thrown client error and returns 0", async () => {
  const svc = {
    from: () => {
      throw new Error("network down");
    },
  };
  const written = await recordVideoSnapshots(
    svc,
    "acct-1",
    [{ tiktok_video_id: "v1", views: 1, likes: 1, comments: 1, shares: 1 }],
    new Date("2026-10-28T15:00:00Z"),
  );
  assertEquals(written, 0);
});

Deno.test("recordVideoSnapshots with no rows writes nothing", async () => {
  const db = createSupabaseQueryMock();
  assertEquals(await recordVideoSnapshots(db as never, "acct-1", []), 0);
  assertEquals(db.calls.length, 0);
});

Deno.test("recordVideoSnapshots keeps the last entry when a video id repeats in one batch", async () => {
  const db = createSupabaseQueryMock();
  await recordVideoSnapshots(
    db as never,
    "acct-1",
    [
      { tiktok_video_id: "v1", views: 1, likes: 1, comments: 1, shares: 1 },
      { tiktok_video_id: "v1", views: 9, likes: 9, comments: 9, shares: 9 },
    ],
    new Date("2026-10-28T15:00:00Z"),
  );
  const call = db.calls.find((c) => c.table === "tiktok_post_metrics_daily");
  const payload = call!.payload as Array<{ views: number }>;
  assertEquals(payload.length, 1);
  assertEquals(payload[0].views, 9);
});
