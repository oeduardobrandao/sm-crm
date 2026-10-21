import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { handleKbViewStats, shapeKbViewStats } from "../platform-admin/kb-views.ts";

const H = { "Content-Type": "application/json" };

Deno.test("shapeKbViewStats: splits by kind and coerces bigint strings to numbers", () => {
  const out = shapeKbViewStats([
    {
      kind: "article", item_id: "a1", views_30d: "48", users_30d: "12",
      views_total: "210", users_total: "64", completed_total: null,
    },
    {
      kind: "video", item_id: "7", views_30d: 3, users_30d: 2,
      views_total: 9, users_total: 5, completed_total: "4",
    },
  ]);
  assertEquals(out, {
    articles: { a1: { views_30d: 48, users_30d: 12, views_total: 210, users_total: 64 } },
    videos: { "7": { views_30d: 3, users_30d: 2, views_total: 9, users_total: 5, completed: 4 } },
  });
});

Deno.test("shapeKbViewStats: ignores unknown kinds and treats junk numbers as 0", () => {
  const out = shapeKbViewStats([
    { kind: "banner", item_id: "x", views_30d: 1, users_30d: 1, views_total: 1, users_total: 1, completed_total: null },
    { kind: "video", item_id: "8", views_30d: "abc", users_30d: null, views_total: 2, users_total: 1, completed_total: null },
  ]);
  assertEquals(out, {
    articles: {},
    videos: { "8": { views_30d: 0, users_30d: 0, views_total: 2, users_total: 1, completed: 0 } },
  });
});

Deno.test("kb-view-stats: returns the shaped payload from the RPC", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("kb_view_stats", {
    data: [{
      kind: "article", item_id: "a1", views_30d: 1, users_30d: 1,
      views_total: 1, users_total: 1, completed_total: null,
    }],
  });
  const res = await handleKbViewStats(db as never, H);
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.articles.a1.views_total, 1);
  assertEquals(body.videos, {});
  assert(db.calls.some((c) => c.table === "rpc:kb_view_stats"), "rpc not called");
});

Deno.test("kb-view-stats: null data is an empty payload", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("kb_view_stats", { data: null });
  const res = await handleKbViewStats(db as never, H);
  assertEquals(await readJson(res), { articles: {}, videos: {} });
});

Deno.test("kb-view-stats: RPC error is thrown for index.ts's generic 500", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("kb_view_stats", { data: null, error: { message: "boom" } });
  let threw = false;
  try {
    await handleKbViewStats(db as never, H);
  } catch {
    threw = true;
  }
  assert(threw, "expected the handler to throw on RPC error");
});
