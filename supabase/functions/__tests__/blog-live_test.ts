// _shared/blog-live.ts: o que conta como post "no ar" (publicado ou publicando no banco,
// mais os posts em arquivo, que sempre estão no ar). Slug inválido nunca chega ao banco.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEquals } from "./assert.ts";
import { BLOG_FILE_POSTS } from "../_shared/blog-file-posts.ts";
import { BLOG_LIVE_STATUSES, BLOG_SLUG_RE, isLiveBlogSlug, liveBlogSlugs } from "../_shared/blog-live.ts";
import { makeFakeDb } from "./mcp-admin-helpers.ts";

const asClient = (db: unknown) => db as SupabaseClient;

Deno.test("BLOG_LIVE_STATUSES e BLOG_SLUG_RE", () => {
  assertEquals([...BLOG_LIVE_STATUSES], ["publicado", "publicando"]);
  assert(BLOG_SLUG_RE.test("a-b-9"));
  assert(!BLOG_SLUG_RE.test("A"));
  assert(!BLOG_SLUG_RE.test(""));
  assert(!BLOG_SLUG_RE.test("a".repeat(121)));
  assert(!BLOG_SLUG_RE.test("a b"));
});

Deno.test("isLiveBlogSlug: slug do banco no ar é true (consulta status e slug)", async () => {
  const { db, calls } = makeFakeDb({ blog_posts: [{ data: { slug: "a" }, error: null }] });
  assertEquals(await isLiveBlogSlug(asClient(db), "a"), true);
  assert(calls.some((c) => c.method === "in" && c.args[0] === "status"));
  assert(calls.some((c) => c.method === "eq" && c.args[0] === "slug" && c.args[1] === "a"));
});

Deno.test("isLiveBlogSlug: post em arquivo é true sem consultar o banco", async () => {
  const { db, calls } = makeFakeDb({});
  assertEquals(await isLiveBlogSlug(asClient(db), "mesaas-vs-mlabs"), true);
  assertEquals(calls.length, 0);
});

Deno.test("isLiveBlogSlug: slug desconhecido é false", async () => {
  const { db } = makeFakeDb({ blog_posts: [{ data: null, error: null }] });
  assertEquals(await isLiveBlogSlug(asClient(db), "nope"), false);
});

Deno.test("isLiveBlogSlug: slug fora do formato é false sem consultar o banco", async () => {
  const { db, calls } = makeFakeDb({});
  assertEquals(await isLiveBlogSlug(asClient(db), "Nope!"), false);
  assertEquals(await isLiveBlogSlug(asClient(db), "a".repeat(121)), false);
  assertEquals(calls.length, 0);
});

Deno.test("isLiveBlogSlug: erro do banco propaga", async () => {
  const { db } = makeFakeDb({ blog_posts: [{ data: null, error: { message: "boom" } }] });
  let threw = false;
  try {
    await isLiveBlogSlug(asClient(db), "a");
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("liveBlogSlugs: linhas do banco mais os seis posts em arquivo", async () => {
  const { db, calls } = makeFakeDb({
    blog_posts: [{ data: [{ slug: "a", date: null }, { slug: "b", date: "2026-10-20" }], error: null }],
  });
  const out = await liveBlogSlugs(asClient(db));
  assert(calls.some((c) => c.method === "in" && c.args[0] === "status"));
  assertEquals(out.length, 2 + BLOG_FILE_POSTS.length);
  assertEquals(BLOG_FILE_POSTS.length, 6);
  assertEquals(out[0], { slug: "a", date: null });
  assertEquals(out[1], { slug: "b", date: "2026-10-20" });
  const mlabs = out.find((r) => r.slug === "mesaas-vs-mlabs");
  assertEquals(mlabs, { slug: "mesaas-vs-mlabs", date: "2026-07-27" });
});

Deno.test("liveBlogSlugs: slug do banco igual a um de arquivo não duplica", async () => {
  const { db } = makeFakeDb({ blog_posts: [{ data: [{ slug: "mesaas-vs-mlabs", date: "2026-01-01" }], error: null }] });
  const out = await liveBlogSlugs(asClient(db));
  assertEquals(out.filter((r) => r.slug === "mesaas-vs-mlabs").length, 1);
  assertEquals(out.length, BLOG_FILE_POSTS.length);
});
