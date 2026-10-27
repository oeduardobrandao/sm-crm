import { assert, assertEquals } from "./assert.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createBlogViewHandler } from "../blog-view/handler.ts";
import { isBotUserAgent, sha256Hex } from "../blog-view/logic.ts";
import { BLOG_FILE_POSTS } from "../_shared/blog-file-posts.ts";

const SALT = "ab".repeat(32);
const IP = "203.0.113.77";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";

interface FakeOpts {
  liveRows?: Array<{ slug: string; status: string }>;
  dbError?: boolean;
  saltError?: boolean;
  recordError?: boolean;
  recordResult?: string;
}

function fakeDb(opts: FakeOpts = {}) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const fromCalls: string[] = [];
  const rows = opts.liveRows ?? [{ slug: "meu-post", status: "publicado" }];
  const db = {
    rpc(fn: string, args?: unknown) {
      rpcCalls.push({ fn, args });
      if (fn === "blog_view_salt_today") {
        return Promise.resolve(
          opts.saltError ? { data: null, error: { message: "boom" } } : { data: SALT, error: null },
        );
      }
      return Promise.resolve(
        fn === "record_blog_view" && opts.recordError
          ? { data: null, error: { message: "boom" } }
          : { data: fn === "record_blog_view" ? (opts.recordResult ?? "inserted") : null, error: null },
      );
    },
    from(table: string) {
      fromCalls.push(table);
      const filters: { statuses?: string[]; slug?: string } = {};
      const q = {
        select: () => q,
        in: (_c: string, v: string[]) => ((filters.statuses = v), q),
        eq: (_c: string, v: string) => ((filters.slug = v), q),
        maybeSingle: () => {
          if (opts.dbError) return Promise.resolve({ data: null, error: { message: "db down" } });
          const hit = rows.find((r) => r.slug === filters.slug && (filters.statuses ?? []).includes(r.status));
          return Promise.resolve({ data: hit ? { slug: hit.slug } : null, error: null });
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, rpcCalls, fromCalls };
}

function setup(opts: FakeOpts & { rateAllowed?: boolean } = {}) {
  const f = fakeDb(opts);
  const rateKeys: string[] = [];
  const rateArgs: Array<[number, number]> = [];
  const handler = createBlogViewHandler({
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "https://www.mesaas.com.br" }),
    db: f.db,
    rateLimit: (key, max, windowSeconds) => {
      rateKeys.push(key);
      rateArgs.push([max, windowSeconds]);
      return Promise.resolve(opts.rateAllowed ?? true);
    },
    getClientIP: () => IP,
  });
  const post = (body: unknown, ua: string | null = BROWSER_UA) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (ua !== null) headers["user-agent"] = ua;
    return handler(
      new Request("http://localhost/blog-view", {
        method: "POST",
        headers,
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  };
  const records = () => f.rpcCalls.filter((c) => c.fn === "record_blog_view");
  return { ...f, handler, post, rateKeys, rateArgs, records };
}

Deno.test("isBotUserAgent: bots, empty and null are bots; browsers are not", () => {
  for (
    const ua of [
      null, "", "   ", "Googlebot/2.1", "Mozilla/5.0 (compatible; bingbot/2.0)", "Baiduspider", "Yahoo! Slurp",
      "Slackbot-LinkExpanding", "HeadlessChrome/120", "Chrome-Lighthouse", "Mozilla/5.0 Speed Insights PageSpeed",
      "facebookexternalhit/1.1", "WhatsApp/2.23", "TelegramBot", "curl/8.4.0", "Wget/1.21", "python-requests/2.31",
      "Mozilla/5.0 (X11) Facebot link preview", "CRAWLER",
    ]
  ) assert(isBotUserAgent(ua), `expected bot: ${ua}`);
  assert(!isBotUserAgent(BROWSER_UA));
  assert(!isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"));
});

Deno.test("sha256Hex: 64 lowercase hex, deterministic", async () => {
  const a = await sha256Hex("x");
  assertEquals(a.length, 64);
  assert(/^[0-9a-f]{64}$/.test(a));
  assertEquals(a, await sha256Hex("x"));
  assertEquals(a, "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");
});

Deno.test("OPTIONS answers 204 with CORS headers and does no work", async () => {
  const t = setup();
  const res = await t.handler(new Request("http://localhost/blog-view", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://www.mesaas.com.br");
  assertEquals(t.rpcCalls.length, 0);
});

Deno.test("non-POST is 405", async () => {
  const t = setup();
  const res = await t.handler(new Request("http://localhost/blog-view", { method: "GET" }));
  assertEquals(res.status, 405);
  assertEquals(t.rpcCalls.length, 0);
});

Deno.test("valid live slug with a browser UA records one view with a hashed visitor", async () => {
  const t = setup();
  const res = await t.post({ slug: "meu-post" });
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://www.mesaas.com.br");
  assertEquals(await res.text(), "");
  const recs = t.records();
  assertEquals(recs.length, 1);
  const args = recs[0].args as { p_slug: string; p_visitor_hash: string };
  assertEquals(args.p_slug, "meu-post");
  assert(/^[0-9a-f]{64}$/.test(args.p_visitor_hash));
  assert(args.p_visitor_hash !== IP);
  // Hash input order: salt, IP, UA, slug.
  assertEquals(args.p_visitor_hash, await sha256Hex(SALT + IP + BROWSER_UA + "meu-post"));
  assertEquals(t.rateArgs[0], [120, 3600]);
});

Deno.test("a publicando post counts", async () => {
  const t = setup({ liveRows: [{ slug: "no-ar", status: "publicando" }] });
  await t.post({ slug: "no-ar" });
  assertEquals(t.records().length, 1);
});

Deno.test("a hand-written file post counts without a blog_posts hit", async () => {
  const t = setup({ liveRows: [] });
  await t.post({ slug: BLOG_FILE_POSTS[0].slug });
  assertEquals(t.records().length, 1);
  assertEquals(t.fromCalls.length, 0);
});

Deno.test("a draft or unknown slug does not count", async () => {
  const t = setup({ liveRows: [{ slug: "rascunho", status: "rascunho" }] });
  assertEquals((await t.post({ slug: "rascunho" })).status, 204);
  assertEquals((await t.post({ slug: "nao-existe" })).status, 204);
  assertEquals(t.records().length, 0);
  assertEquals(t.rpcCalls.length, 0);
});

Deno.test("bot and empty UA are dropped before any work", async () => {
  const t = setup();
  assertEquals((await t.post({ slug: "meu-post" }, "Googlebot/2.1")).status, 204);
  assertEquals((await t.post({ slug: "meu-post" }, "")).status, 204);
  assertEquals((await t.post({ slug: "meu-post" }, null)).status, 204);
  assertEquals(t.rpcCalls.length, 0);
  assertEquals(t.fromCalls.length, 0);
  assertEquals(t.rateKeys.length, 0);
});

Deno.test("malformed slugs, bodies and types are dropped", async () => {
  const t = setup();
  for (const body of [{ slug: "../x" }, { slug: "A" }, { slug: "" }, { slug: 5 }, {}, null, "not json", "[]", { slug: "a".repeat(121) }]) {
    assertEquals((await t.post(body)).status, 204);
  }
  assertEquals(t.rpcCalls.length, 0);
  assertEquals(t.fromCalls.length, 0);
});

Deno.test("rate limited: 204 and no record_blog_view", async () => {
  const t = setup({ rateAllowed: false });
  const res = await t.post({ slug: "meu-post" });
  assertEquals(res.status, 204);
  assertEquals(t.records().length, 0);
});

Deno.test("rate key ignores the UA, carries a salted hash and never the raw IP", async () => {
  const t = setup();
  await t.post({ slug: "meu-post" }, BROWSER_UA);
  await t.post({ slug: "meu-post" }, "Mozilla/5.0 (Windows NT 10.0) Firefox/121.0");
  const keys = t.rateKeys;
  assertEquals(keys.length, 2);
  assertEquals(keys[0], keys[1]);
  assertEquals(keys[0], "blog-view:" + await sha256Hex(SALT + IP));
  assert(!t.rateKeys.some((k) => k.includes(IP)));
});

Deno.test("per-post cap (inside record_blog_view): logs one line with the slug only, still 204", async () => {
  const warned: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warned.push(args.join(" "));
  try {
    const capped = setup({ recordResult: "capped" });
    const res = await capped.post({ slug: "meu-post" });
    assertEquals(res.status, 204);
    assertEquals(await res.text(), "");
    // A dedupe hit or a new row logs nothing.
    for (const recordResult of ["duplicate", "inserted"]) await setup({ recordResult }).post({ slug: "meu-post" });
  } finally {
    console.warn = original;
  }
  assertEquals(warned.length, 1);
  assert(warned[0].includes("meu-post"));
  assert(!warned[0].includes(IP) && !warned[0].includes("Mozilla"));
  assert(!/[0-9a-f]{64}/.test(warned[0]), "logged a hash");
});

Deno.test("visitor hash: same IP+UA is stable, a different UA differs, raw IP/UA never reach the db", async () => {
  const t = setup();
  const otherUa = "Mozilla/5.0 (Windows NT 10.0) Firefox/121.0";
  await t.post({ slug: "meu-post" }, BROWSER_UA);
  await t.post({ slug: "meu-post" }, BROWSER_UA);
  await t.post({ slug: "meu-post" }, otherUa);
  const hashes = t.records().map((c) => (c.args as { p_visitor_hash: string }).p_visitor_hash);
  assertEquals(hashes[0], hashes[1]);
  assert(hashes[0] !== hashes[2]);
  const everything = JSON.stringify(t.rpcCalls) + t.rateKeys.join("|");
  assert(!everything.includes(IP));
  assert(!everything.includes("Mozilla"));
});

Deno.test("visitor hash: the same reader gets a different hash on each post", async () => {
  const t = setup({ liveRows: [{ slug: "post-um", status: "publicado" }, { slug: "post-dois", status: "publicado" }] });
  await t.post({ slug: "post-um" });
  await t.post({ slug: "post-dois" });
  const hashes = t.records().map((c) => (c.args as { p_visitor_hash: string }).p_visitor_hash);
  assertEquals(hashes.length, 2);
  assert(hashes[0] !== hashes[1], "one reader is linkable across posts");
});

Deno.test("the salt is fetched on every counted request, never cached", async () => {
  const t = setup();
  await t.post({ slug: "meu-post" });
  await t.post({ slug: "meu-post" });
  assertEquals(t.rpcCalls.filter((c) => c.fn === "blog_view_salt_today").length, 2);
});

Deno.test("db failures still answer 204 with an empty body", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    for (const opts of [{ dbError: true }, { saltError: true }, { recordError: true }] as FakeOpts[]) {
      const t = setup(opts);
      const res = await t.post({ slug: "meu-post" });
      assertEquals(res.status, 204);
      assertEquals(await res.text(), "");
    }
  } finally {
    console.error = original;
  }
  assertEquals(logged.length, 3);
  assert(logged.every((l) => !l.includes(IP) && !l.includes("Mozilla")));
});
