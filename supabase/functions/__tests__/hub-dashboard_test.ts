import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubDashboardHandler } from "../hub-dashboard/handler.ts";

const now = () => "2026-04-17T12:00:00.000Z";
const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubDashboardHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
}

Deno.test("hub-dashboard returns top posts, follower history, reach history, and account for a valid token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: {
      id: "ig-acc-1",
      follower_count: 15300,
      following_count: 892,
      media_count: 42,
      reach_28d: 89000,
      impressions_28d: 120000,
      last_synced_at: "2026-04-17T10:00:00.000Z",
    },
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [
      {
        instagram_post_id: "ig-post-1",
        thumbnail_url: "https://cdn.ig/thumb1.jpg",
        media_type: "IMAGE",
        permalink: "https://instagram.com/p/abc",
        posted_at: "2026-04-10T10:00:00.000Z",
        likes: 120,
        comments: 15,
        reach: 5000,
        impressions: 6000,
        saved: 80,
        shares: 25,
      },
      {
        instagram_post_id: "ig-post-2",
        thumbnail_url: null,
        media_type: "VIDEO",
        permalink: "https://instagram.com/p/def",
        posted_at: "2026-04-05T14:00:00.000Z",
        likes: 90,
        comments: 10,
        reach: 4000,
        impressions: 5000,
        saved: 50,
        shares: 15,
      },
    ],
    error: null,
  });
  db.queue("instagram_follower_history", "select", {
    data: [
      { date: "2026-03-18", follower_count: 14000 },
      { date: "2026-04-17", follower_count: 15300 },
    ],
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [
      { posted_at: "2026-04-05T14:00:00.000Z", reach: 4000, impressions: 5000 },
      { posted_at: "2026-04-10T10:00:00.000Z", reach: 5000, impressions: 6000 },
    ],
    error: null,
  });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123&period=30"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.topPosts.length, 2);
  assertEquals(body.topPosts[0].id, "ig-post-1");
  assertEquals(body.topPosts[0].engagementRate, 4.8);
  assertEquals(body.followerHistory.length, 2);
  assertEquals(body.reachHistory.length, 2);
  assertEquals(body.account.followerCount, 15300);
  assertEquals(body.period, 30);
});

Deno.test("hub-dashboard returns empty data when no Instagram account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.topPosts, []);
  assertEquals(body.followerHistory, []);
  assertEquals(body.reachHistory, []);
  assertEquals(body.account, null);
  assertEquals(body.period, 30);
});

Deno.test("hub-dashboard rejects missing token with 400", async () => {
  const handler = makeHandler(createSupabaseQueryMock());
  const response = await handler(new Request("https://example.test/hub-dashboard"));
  assertEquals(response.status, 400);
});

Deno.test("hub-dashboard returns 404 for invalid tokens", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=expired"));
  assertEquals(response.status, 404);
});

Deno.test("hub-dashboard defaults period to 30 for an invalid value", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123&period=999"));
  const body = await response.json();

  assertEquals(body.period, 30);
});

Deno.test("hub-dashboard handles CORS preflight", async () => {
  const handler = makeHandler(createSupabaseQueryMock());
  const response = await handler(new Request("https://example.test/hub-dashboard", { method: "OPTIONS" }));
  assertEquals(response.status, 200);
});

Deno.test("hub-dashboard rejects non-GET methods with 405", async () => {
  const handler = makeHandler(createSupabaseQueryMock());
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123", { method: "POST" }));
  assertEquals(response.status, 405);
});
