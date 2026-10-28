import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { loadTikTokReportSection } from "./tiktok-section.ts";

// Fake db that APPLIES eq/gte/lt/lte/order/limit/range to in-memory rows, so the SP month
// boundaries are proven by data (a video outside the window really drops out), not by
// asserting query arguments.
type Row = Record<string, unknown>;
function makeDb(tables: Record<string, Row[]>, opts: { errors?: Record<string, { message: string }> } = {}) {
  // deno-lint-ignore no-explicit-any
  const query = (table: string): any => {
    let rows = [...(tables[table] ?? [])];
    let orders: { col: string; asc: boolean }[] = [];
    let slice: [number, number] | null = null;
    const error = opts.errors?.[table] ?? null;
    const cmp = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
    const result = () => {
      let out = [...rows];
      if (orders.length) {
        out.sort((a, b) => {
          for (const o of orders) {
            const c = cmp(a[o.col], b[o.col]);
            if (c !== 0) return o.asc ? c : -c;
          }
          return 0;
        });
      }
      if (slice) out = out.slice(slice[0], slice[1] + 1);
      return out;
    };
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), c);
    c.gte = (col: string, v: unknown) => ((rows = rows.filter((r) => cmp(r[col], v) >= 0)), c);
    c.lt = (col: string, v: unknown) => ((rows = rows.filter((r) => cmp(r[col], v) < 0)), c);
    c.lte = (col: string, v: unknown) => ((rows = rows.filter((r) => cmp(r[col], v) <= 0)), c);
    c.order = (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending !== false }), c);
    c.limit = (n: number) => ((slice = [0, n - 1]), c);
    c.range = (from: number, to: number) => ((slice = [from, to]), c);
    c.maybeSingle = () => Promise.resolve({ data: error ? null : (result()[0] ?? null), error });
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: error ? null : result(), error }).then(resolve);
    orders = [];
    return c;
  };
  // deno-lint-ignore no-explicit-any
  return { from: (table: string) => query(table) } as any;
}

const account = (over: Row = {}): Row => ({
  id: "tt-1",
  client_id: 1,
  username: "dra.tt",
  display_name: "Dra TT",
  avatar_url: "https://storage.example/tiktok-avatars/tt-1.jpg",
  follower_count: 5000,
  likes_count: 90000,
  video_count: 40,
  authorization_status: "active",
  last_synced_at: "2026-10-27T10:00:00Z",
  ...over,
});

const video = (id: string, postedAt: string, views: number, over: Row = {}): Row => ({
  tiktok_account_id: "tt-1",
  tiktok_video_id: id,
  posted_at: postedAt,
  views,
  likes: 10,
  comments: 2,
  shares: 1,
  title: `Título ${id}`,
  video_description: `Descrição ${id}`,
  duration: 30,
  share_url: `https://www.tiktok.com/@dra.tt/video/${id}`,
  cover_image_url: `https://storage.example/tiktok-posts/${id}.jpg`,
  ...over,
});

// Closed month: the generation instant is well after September.
const NOW = new Date("2026-10-28T15:00:00Z");

Deno.test("tiktok-section: null without a tiktok_accounts row", async () => {
  const db = makeDb({ tiktok_accounts: [] });
  assertEquals(await loadTikTokReportSection(db, 1, "2026-09", NOW), null);
});

Deno.test("tiktok-section: null when the account is disconnected or revoked", async () => {
  for (const status of ["disconnected", "revoked"]) {
    const db = makeDb({ tiktok_accounts: [account({ authorization_status: status })] });
    assertEquals(await loadTikTokReportSection(db, 1, "2026-09", NOW), null, status);
  }
});

Deno.test("tiktok-section top_posts sorted by views, max 12", async () => {
  const videos = Array.from({ length: 15 }, (_, i) =>
    video(`v${String(i).padStart(2, "0")}`, `2026-09-${String(i + 2).padStart(2, "0")}T15:00:00Z`, (i * 37) % 15 * 100)
  );
  const db = makeDb({ tiktok_accounts: [account()], tiktok_posts: videos });
  const res = await loadTikTokReportSection(db, 1, "2026-09", NOW);
  assert(res);
  assertEquals(res.accountId, "tt-1");
  const top = res.section.top_posts;
  assertEquals(top.length, 12);
  for (let i = 1; i < top.length; i++) assert(top[i - 1].views >= top[i].views, `ordem em ${i}`);
  assertEquals(top[0].views, 1400);
  const first = top[0];
  assertEquals(first.caption_preview, `Título ${first.video_id}`);
  assertEquals(first.permalink, `https://www.tiktok.com/@dra.tt/video/${first.video_id}`);
  assertEquals(first.thumbnail_url, `https://storage.example/tiktok-posts/${first.video_id}.jpg`);
  assertEquals(res.section.kpis.posts_count.value, 15);
});

Deno.test("tiktok-section: a cover still on the TikTok CDN is not frozen into the snapshot", async () => {
  const db = makeDb({
    tiktok_accounts: [account()],
    tiktok_posts: [
      video("a", "2026-09-10T15:00:00Z", 10, {
        cover_image_url: "https://p16-sign.tiktokcdn.com/obj/a.jpeg?x-expires=1",
      }),
    ],
  });
  const res = await loadTikTokReportSection(db, 1, "2026-09", NOW);
  assert(res);
  assertEquals(res.section.top_posts[0].thumbnail_url, null);
});

Deno.test("tiktok-section: caption falls back to the description and is truncated to 140", async () => {
  const db = makeDb({
    tiktok_accounts: [account()],
    tiktok_posts: [video("a", "2026-09-10T15:00:00Z", 10, { title: null, video_description: "x".repeat(300) })],
  });
  const res = await loadTikTokReportSection(db, 1, "2026-09", NOW);
  assert(res);
  assertEquals(res.section.top_posts[0].caption_preview, "x".repeat(140));
});

Deno.test("tiktok-section uses SP month boundaries", async () => {
  // 2026-10-01T02:00Z is 2026-09-30 23:00 in São Paulo: September, not October.
  const db = () =>
    makeDb({
      tiktok_accounts: [account()],
      tiktok_posts: [
        video("late-sep", "2026-10-01T02:00:00Z", 500),
        video("early-oct", "2026-10-01T03:00:00Z", 700),
        // 2026-09-01T02:00Z is still August 31 in São Paulo.
        video("late-aug", "2026-09-01T02:00:00Z", 900),
      ],
    });
  const sep = await loadTikTokReportSection(db(), 1, "2026-09", NOW);
  assert(sep);
  assertEquals(sep.section.top_posts.map((p) => p.video_id), ["late-sep"]);
  assertEquals(sep.section.kpis.views.value, 500);

  const oct = await loadTikTokReportSection(db(), 1, "2026-10", NOW);
  assert(oct);
  assertEquals(oct.section.top_posts.map((p) => p.video_id), ["early-oct"]);
});

Deno.test("tiktok-section: follower trend is the month's history; closed month reads the history, not the live count", async () => {
  const db = makeDb({
    tiktok_accounts: [account({ follower_count: 9999 })],
    tiktok_follower_history: [
      { tiktok_account_id: "tt-1", date: "2026-08-31", follower_count: 900, source: "api" },
      { tiktok_account_id: "tt-1", date: "2026-09-01", follower_count: 1000, source: "api" },
      { tiktok_account_id: "tt-1", date: "2026-09-15", follower_count: 1100, source: "manual" },
      { tiktok_account_id: "tt-1", date: "2026-09-30", follower_count: 1250, source: "api" },
      { tiktok_account_id: "tt-1", date: "2026-10-01", follower_count: 1300, source: "api" },
    ],
  });
  const res = await loadTikTokReportSection(db, 1, "2026-09", NOW);
  assert(res);
  assertEquals(res.section.follower_trend, [
    { date: "2026-09-01", count: 1000 },
    { date: "2026-09-15", count: 1100 },
    { date: "2026-09-30", count: 1250 },
  ]);
  assertEquals(res.section.kpis.followers_total.value, 1250);
  assertEquals(res.section.kpis.followers_gained.value, 250);
  assertEquals(res.section.kpis.views.prev, null);
});

Deno.test("tiktok-section: likes_total is the last daily row on or before the month end for a closed month", async () => {
  const db = makeDb({
    tiktok_accounts: [account({ likes_count: 99999 })],
    tiktok_account_metrics_daily: [
      { tiktok_account_id: "tt-1", snapshot_date: "2026-09-20", likes_count: 700 },
      { tiktok_account_id: "tt-1", snapshot_date: "2026-09-29", likes_count: 800 },
      { tiktok_account_id: "tt-1", snapshot_date: "2026-10-02", likes_count: 900 },
    ],
  });
  const res = await loadTikTokReportSection(db, 1, "2026-09", NOW);
  assert(res);
  assertEquals(res.section.kpis.likes_total.value, 800);
});

Deno.test("tiktok-section: current month uses the live account counts", async () => {
  const db = makeDb({
    tiktok_accounts: [account({ likes_count: 4321, follower_count: 5000 })],
    tiktok_account_metrics_daily: [
      { tiktok_account_id: "tt-1", snapshot_date: "2026-10-20", likes_count: 100 },
    ],
    tiktok_follower_history: [
      { tiktok_account_id: "tt-1", date: "2026-10-01", follower_count: 4000, source: "api" },
      { tiktok_account_id: "tt-1", date: "2026-10-20", follower_count: 4500, source: "api" },
    ],
  });
  const res = await loadTikTokReportSection(db, 1, "2026-10", NOW);
  assert(res);
  assertEquals(res.section.kpis.likes_total.value, 4321);
  assertEquals(res.section.kpis.followers_total.value, 5000);
});

Deno.test("tiktok-section: best times cover the 90 SP days before the effective end", async () => {
  const db = makeDb({
    tiktok_accounts: [account()],
    tiktok_posts: [
      // Wednesday 2026-09-30 20:00 São Paulo.
      video("in", "2026-09-30T23:00:00Z", 100, { likes: 10, comments: 0, shares: 0 }),
      // More than 90 days before 2026-09-30: outside the grid.
      video("old", "2026-06-01T15:00:00Z", 100, { likes: 50, comments: 0, shares: 0 }),
    ],
  });
  const res = await loadTikTokReportSection(db, 1, "2026-09", NOW);
  assert(res);
  assertEquals(res.section.best_times, [{ day: "Qua", hour: 20, avg_engagement: 10 }]);
  assertEquals(res.section.account, {
    handle: "dra.tt",
    display_name: "Dra TT",
    avatar_url: "https://storage.example/tiktok-avatars/tt-1.jpg",
  });
});
