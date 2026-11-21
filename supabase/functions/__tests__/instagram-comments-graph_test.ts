import { assert, assertEquals } from "./assert.ts";
import {
  deleteComment,
  fetchMediaComments,
  getCommentRef,
  GraphNoSuccess,
  isCommentUnavailable,
  setCommentHidden,
} from "../instagram-analytics/comments-graph.ts";
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
    { mediaId: "m1", token: "tk", max: 120, deadlineAt: Date.now() + 60_000, ownerIds: [] },
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
    { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000, ownerIds: [] },
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
    { mediaId: "m1", token: "tk", max: 500, deadlineAt: 40_000, ownerIds: [] },
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
    { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000, ownerIds: [] },
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
      { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000, ownerIds: [] },
    );
  } catch (e) { threw = e; }
  assert(threw instanceof IgApiError);
});

Deno.test("erro na segunda devolve a primeira com truncated", async () => {
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([pageWithNext(0), { status: 500, body: {} }]) },
    { mediaId: "m1", token: "tk", max: 500, deadlineAt: Date.now() + 60_000, ownerIds: [] },
  );
  assertEquals(r.comments.length, 50);
  assertEquals(r.truncated, true);
});

Deno.test("comentário sem text vira string vazia e não quebra", async () => {
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([{ data: [{ id: "x", timestamp: "t", username: "u", like_count: 2 }] }]) },
    { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000, ownerIds: [] },
  );
  assertEquals(r.comments[0].text, "");
});

Deno.test("username vazio cai para from.username e pede o campo from", async () => {
  const urls: string[] = [];
  const r = await fetchMediaComments(
    {
      fetchFn: pagedFetch([{
        data: [
          { id: "a", text: "x", timestamp: "t", like_count: 0, from: { id: "1", username: "ana" } },
          { id: "b", text: "x", timestamp: "t", username: "bia", like_count: 0, from: { id: "2", username: "outra" } },
          { id: "c", text: "x", timestamp: "t", like_count: 0 },
        ],
      }], urls),
    },
    { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000, ownerIds: [] },
  );
  assertEquals(r.comments.map((c) => c.username), ["ana", "bia", ""]);
  assert(decodeURIComponent(urls[0]).includes("from{id,username}"));
});

const ARGS = { mediaId: "m1", token: "tk", max: 100, deadlineAt: Date.now() + 60_000, ownerIds: [] as string[] };
const raw = (id: string, extra: Record<string, unknown> = {}) => ({
  id, text: `t${id}`, timestamp: "t", username: "u", like_count: 0, ...extra,
});

Deno.test("dedupe: resposta solta e aninhada aparece uma vez com parent_id", async () => {
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([{ data: [raw("c1", { replies: { data: [{ id: "c2" }] } }), raw("c2")] }]) },
    ARGS,
  );
  assertEquals(r.comments.map((c) => c.id), ["c1", "c2"]);
  assertEquals(r.comments[1].parent_id, "c1");
  assertEquals(r.comments[0].parent_id, null);
});

Deno.test("dedupe: resposta numa página antes do pai também recebe parent_id", async () => {
  const r = await fetchMediaComments(
    {
      fetchFn: pagedFetch([
        { data: [raw("c2")], paging: { cursors: { after: "a" }, next: "n" } },
        { data: [raw("c1", { replies: { data: [{ id: "c2" }] } }), raw("c2")] },
      ]),
    },
    ARGS,
  );
  assertEquals(r.comments.map((c) => c.id), ["c2", "c1"]);
  assertEquals(r.comments[0].parent_id, "c1");
});

Deno.test("parent_id do item vence a derivação", async () => {
  const r = await fetchMediaComments(
    {
      fetchFn: pagedFetch([{
        data: [raw("c1", { replies: { data: [{ id: "c2" }] } }), raw("c2", { parent_id: "c9" })],
      }]),
    },
    ARGS,
  );
  assertEquals(r.comments[1].parent_id, "c9");
});

Deno.test("hidden vem do item, ausente vira false", async () => {
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([{ data: [raw("a", { hidden: true }), raw("b")] }]) },
    ARGS,
  );
  assertEquals(r.comments.map((c) => c.hidden), [true, false]);
});

Deno.test("from_owner compara from.id com qualquer ownerId e não expõe from.id", async () => {
  const r = await fetchMediaComments(
    {
      fetchFn: pagedFetch([{
        data: [raw("a", { from: { id: "222", username: "dono" } }), raw("b", { from: { id: "9" } }), raw("c")],
      }]),
    },
    { ...ARGS, ownerIds: ["111", "222"] },
  );
  assertEquals(r.comments.map((c) => c.from_owner), [true, false, false]);
  assertEquals("from" in r.comments[0], false);
  assert(!JSON.stringify(r.comments).includes("222"));
});

Deno.test("fields pede hidden e parent_id", async () => {
  const urls: string[] = [];
  await fetchMediaComments({ fetchFn: pagedFetch([{ data: [] }], urls) }, ARGS);
  const fields = new URL(urls[0]).searchParams.get("fields") ?? "";
  assert(fields.includes("hidden"));
  assert(fields.includes("parent_id"));
});

Deno.test("max conta itens únicos", async () => {
  const r = await fetchMediaComments(
    { fetchFn: pagedFetch([{ data: [raw("a"), raw("a"), raw("b"), raw("c")] }]) },
    { ...ARGS, max: 3 },
  );
  assertEquals(r.comments.map((c) => c.id), ["a", "b", "c"]);
  assertEquals(r.truncated, false);
});

Deno.test("getCommentRef mapeia media, from e parent_id; ausentes viram null", async () => {
  const urls: string[] = [];
  const full = await getCommentRef(
    { fetchFn: pagedFetch([{ id: "c1", media: { id: "m1" }, from: { id: "7" }, parent_id: "p" }], urls) },
    { commentId: "c1", token: "tk" },
  );
  assertEquals(full, { id: "c1", mediaId: "m1", fromId: "7", parentId: "p" });
  const fields = new URL(urls[0]).searchParams.get("fields");
  assertEquals(fields, "id,media{id},from{id},parent_id");
  assert(!urls[0].includes("access_token"));
  const bare = await getCommentRef({ fetchFn: pagedFetch([{ id: "c2" }]) }, { commentId: "c2", token: "tk" });
  assertEquals(bare, { id: "c2", mediaId: null, fromId: null, parentId: null });
});

// deno-lint-ignore no-explicit-any
function recordingFetch(body: any) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = ((url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

Deno.test("setCommentHidden manda POST /{id}?hide=true e =false, sem body, Bearer no header", async () => {
  for (const hidden of [true, false]) {
    const { calls, fetchFn } = recordingFetch({ success: true });
    await setCommentHidden({ fetchFn }, { commentId: "c/1", token: "tk", hidden });
    assertEquals(calls.length, 1);
    assert(calls[0].url.endsWith(`/c%2F1?hide=${hidden}`));
    assertEquals(calls[0].init.method, "POST");
    assertEquals(calls[0].init.body, undefined);
    assertEquals((calls[0].init.headers as Record<string, string>).Authorization, "Bearer tk");
    assert(!calls[0].url.includes("access_token"));
  }
  let threw: unknown;
  try {
    await setCommentHidden({ fetchFn: recordingFetch({}).fetchFn }, { commentId: "c1", token: "tk", hidden: true });
  } catch (e) { threw = e; }
  assert(threw instanceof GraphNoSuccess);
});

Deno.test("deleteComment manda DELETE /{id}; success:false lança GraphNoSuccess", async () => {
  const { calls, fetchFn } = recordingFetch({ success: true });
  await deleteComment({ fetchFn }, { commentId: "c1", token: "tk" });
  assertEquals(calls[0].init.method, "DELETE");
  assert(calls[0].url.endsWith("/c1"));
  let threw: unknown;
  try {
    await deleteComment({ fetchFn: recordingFetch({ success: false }).fetchFn }, { commentId: "c1", token: "tk" });
  } catch (e) { threw = e; }
  assert(threw instanceof GraphNoSuccess);
});

Deno.test("isCommentUnavailable só para 100/33", () => {
  assertEquals(isCommentUnavailable(new IgApiError("x", { graphCode: 100, graphSubcode: 33 })), true);
  assertEquals(isCommentUnavailable(new IgApiError("x", { graphCode: 100, graphSubcode: 0 })), false);
  assertEquals(isCommentUnavailable(new IgApiError("x", { graphCode: 190 })), false);
  assertEquals(isCommentUnavailable(new Error("x")), false);
});
