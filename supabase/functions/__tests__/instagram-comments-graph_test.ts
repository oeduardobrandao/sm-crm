import { assert, assertEquals } from "./assert.ts";
import { fetchMediaComments } from "../instagram-analytics/comments-graph.ts";
import { IgApiError } from "../_shared/instagram-messaging.ts";

// deno-lint-ignore no-explicit-any
function mk(n: number, start = 0, extra: any = {}): any[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${start + i}`, text: `t${start + i}`, timestamp: "2026-01-01T00:00:00+0000",
    username: "u", like_count: 1, ...extra,
  }));
}

// deno-lint-ignore no-explicit-any
function pagedFetch(pages: any[], urls: string[] = []): typeof fetch {
  let i = 0;
  // deno-lint-ignore no-explicit-any
  return ((input: any) => {
    urls.push(String(input));
    const p = pages[i++];
    if (p instanceof Error) return Promise.reject(p);
    return Promise.resolve(new Response(JSON.stringify(p.body ?? p), { status: p.status ?? 200 }));
  }) as unknown as typeof fetch;
}

const pageWithNext = (start: number, n = 50) => ({
  data: mk(n, start),
  paging: { cursors: { after: `cur${start}` }, next: "https://graph/next?access_token=x" },
});

Deno.test("pagina até max e marca truncated", async () => {
  const urls: string[] = [];
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([pageWithNext(0), pageWithNext(50), pageWithNext(100)], urls) },
    { mediaId: "m1", token: "tk", max: 120, deadlineAt: Date.now() + 60_000 },
  );
  assertEquals(r.comments.length, 120);
  assertEquals(r.truncated, true);
  assertEquals(urls.length, 3);
  assert(urls[1].includes("after=cur0"));
  assert(!urls.some((u) => u.includes("access_token")));
});

Deno.test("sem paging.next termina com truncated false", async () => {
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([{ data: mk(3) }]) },
    { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000 },
  );
  assertEquals(r.comments.length, 3);
  assertEquals(r.truncated, false);
});

Deno.test("para no prazo", async () => {
  let t = 0;
  let calls = 0;
  const base = pagedFetch([pageWithNext(0), pageWithNext(50), pageWithNext(100)]);
  const fetchFn = ((...a: Parameters<typeof fetch>) => { calls++; t += 30_000; return base(...a); }) as typeof fetch;
  const r = await fetchMediaComments(
    { fetchFn, now: () => t },
    { mediaId: "m1", token: "tk", max: 500, deadlineAt: 40_000 },
  );
  assert(calls <= 2);
  assertEquals(r.truncated, true);
});

Deno.test("replies_count e replies_more", async () => {
  const c3 = { id: "a", text: "x", timestamp: "t", username: "u", like_count: 0, replies: { data: [{ id: "1" }, { id: "2" }, { id: "3" }] } };
  const c25 = { id: "b", text: "x", timestamp: "t", username: "u", like_count: 0, replies: { data: Array.from({ length: 25 }, (_, i) => ({ id: `r${i}` })) } };
  const none = { id: "c", text: "x", timestamp: "t", username: "u", like_count: 0 };
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([{ data: [c3, c25, none] }]) },
    { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000 },
  );
  assertEquals([r.comments[0].replies_count, r.comments[0].replies_more], [3, false]);
  assertEquals([r.comments[1].replies_count, r.comments[1].replies_more], [25, true]);
  assertEquals([r.comments[2].replies_count, r.comments[2].replies_more], [0, false]);
});

Deno.test("erro na primeira página propaga IgApiError", async () => {
  let threw: unknown;
  try {
    await fetchMediaComments(
      { fetchFn: pagedFetch([{ status: 400, body: { error: { message: "bad", code: 10 } } }]) },
      { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000 },
    );
  } catch (e) { threw = e; }
  assert(threw instanceof IgApiError);
});

Deno.test("erro na segunda devolve a primeira com truncated", async () => {
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([pageWithNext(0), { status: 500, body: {} }]) },
    { mediaId: "m1", token: "tk", max: 500, deadlineAt: Date.now() + 60_000 },
  );
  assertEquals(r.comments.length, 50);
  assertEquals(r.truncated, true);
});

Deno.test("comentário sem text vira string vazia e não quebra", async () => {
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([{ data: [{ id: "x", timestamp: "t", username: "u", like_count: 2 }] }]) },
    { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000 },
  );
  assertEquals(r.comments[0].text, "");
});
